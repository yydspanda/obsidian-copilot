import type {
  CompilerTargetObservation,
  CompilerTargetRequest,
} from "@/knowledge/compiler/CompilerModelPort";
import { ObsidianKnowledgeCompilerTargetResolver } from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import { isKnowledgeAbortError } from "@/knowledge/errors/abortError";
import {
  KnowledgeForwardRevisionApplyCoordinatorError,
  KnowledgeProductionForwardRevisionApplyCoordinator,
  type KnowledgeProductionForwardRevisionApplyRecoveryResult,
} from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionApplyCoordinator";
import { KnowledgeProductionForwardRevisionDecisionCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionDecisionCoordinator";
import {
  createKnowledgeForwardRevisionReviewCommand,
  type KnowledgeForwardRevisionReviewCommandV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  type KnowledgeForwardRevisionAbandonmentRecordV1,
  snapshotKnowledgeForwardRevisionAbandonmentRecord,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionLifecycleTerminal";
import {
  type KnowledgeForwardRevisionStudioAcceptedReadyRecord,
  type KnowledgeForwardRevisionStudioActiveRecord,
  type KnowledgeForwardRevisionStudioPendingRecord,
  type KnowledgeForwardRevisionStudioRecoveryRequiredRecord,
  createKnowledgeForwardRevisionStudioAcceptedIdentity,
  snapshotKnowledgeForwardRevisionStudioSnapshot,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioProjection";
import {
  type KnowledgeForwardRevisionStudioCommand,
  type KnowledgeForwardRevisionStudioPort,
  type KnowledgeForwardRevisionStudioReview,
  type KnowledgeForwardRevisionStudioSubmissionResult,
  type KnowledgeForwardRevisionStudioUiSnapshot,
  snapshotKnowledgeForwardRevisionStudioCommand,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioPort";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";
import {
  composeKnowledgeReviewSelectedContent,
  createKnowledgeReviewBlocks,
  type KnowledgeReviewBlock,
  type KnowledgeReviewFile,
  type KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";
import { KnowledgeRuntimeForwardRevisionStudioPort } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { sha256 } from "@/utils/hash";

const MAX_CONSISTENCY_ATTEMPTS = 3;
const MAX_WIKI_PAGE_BYTES = 8_000_000;
const MAX_WIKI_PAGE_CHARACTERS = 2_000_000;
const MAX_TOTAL_WIKI_PAGE_BYTES = 64_000_000;
const MAX_TOTAL_WIKI_PAGE_CHARACTERS = 16_000_000;
const MAX_INLINE_DIFF_CHARACTERS = 200_000;
const MAX_INLINE_DIFF_LINES = 2_000;
const MAX_RETAINED_BUNDLE_CACHES = 256;

const APPLIED_RESULT = Object.freeze({ kind: "applied" as const });
const REJECTED_RESULT = Object.freeze({ kind: "rejected" as const });
const ACCEPTED_READY_RESULT = Object.freeze({ kind: "accepted_ready" as const });
const ABANDONED_RESULT = Object.freeze({ kind: "abandoned" as const });
const KEPT_CURRENT_RESULT = Object.freeze({ kind: "kept_current" as const });
const APPLYING_RESULT = Object.freeze({ kind: "applying" as const });
const NO_CHANGE_RESULT = Object.freeze({ kind: "no_change" as const });
const RECOVERY_REQUIRED_RESULT = Object.freeze({ kind: "recovery_required" as const });
const STALE_RESULT = Object.freeze({ kind: "stale" as const });
const UNAVAILABLE_RESULT = Object.freeze({ kind: "unavailable" as const });

type CurrentObservation =
  | Readonly<{ kind: "file"; content: string; contentHash: string; byteSize: number }>
  | Readonly<{ kind: "missing" | "occupied" | "directory" | "unavailable" }>;

interface HiddenReviewBinding {
  readonly bundleId: string;
  readonly runtimeRevision: number;
  readonly durable: Readonly<KnowledgeForwardRevisionStudioActiveRecord>;
  readonly ui: Readonly<KnowledgeForwardRevisionStudioReview>;
}

/** Narrow Runtime mutation added to the authentic generation-bound Studio facade. */
export interface KnowledgeForwardRevisionStudioAbandonRuntimePort {
  /** Atomically terminalizes one exact accepted-ready identity without starting a write. */
  abandonForwardRevisionAcceptedReady(
    acceptedIdentity: unknown,
    expectedRuntimeRevision: number
  ): Promise<Readonly<KnowledgeForwardRevisionAbandonmentRecordV1>>;
}

type ProductionForwardRevisionStudioRuntime = KnowledgeRuntimeForwardRevisionStudioPort &
  KnowledgeForwardRevisionStudioAbandonRuntimePort;

interface BundleCache {
  sequence: number;
  rows: ReadonlyMap<string, Readonly<HiddenReviewBinding>>;
}

interface CoordinatorCache {
  readonly bundles: Map<string, BundleCache>;
}

interface CoordinatorState {
  readonly runtime: ProductionForwardRevisionStudioRuntime;
  readonly decisions: KnowledgeProductionForwardRevisionDecisionCoordinator;
  readonly apply: KnowledgeProductionForwardRevisionApplyCoordinator;
  readonly targetVisitor: ObsidianKnowledgeCompilerTargetResolver;
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly assertCurrent: () => void;
  readonly cache: CoordinatorCache;
}

interface ProjectedUiState {
  readonly snapshot: Readonly<KnowledgeForwardRevisionStudioUiSnapshot>;
  readonly rows: ReadonlyMap<string, Readonly<HiddenReviewBinding>>;
}

const coordinatorStates = new WeakMap<object, Readonly<CoordinatorState>>();

/** Returns one per-Bundle cache, evicting only the oldest opaque UI binding when bounded. */
function retainBundleCache(state: Readonly<CoordinatorState>, bundleId: string): BundleCache {
  const existing = state.cache.bundles.get(bundleId);
  if (existing) {
    state.cache.bundles.delete(bundleId);
    state.cache.bundles.set(bundleId, existing);
    return existing;
  }
  if (state.cache.bundles.size >= MAX_RETAINED_BUNDLE_CACHES) {
    const oldestBundleId = state.cache.bundles.keys().next().value as string | undefined;
    if (oldestBundleId !== undefined) state.cache.bundles.delete(oldestBundleId);
  }
  const created: BundleCache = { sequence: 0, rows: new Map() };
  state.cache.bundles.set(bundleId, created);
  return created;
}

/** Creates platform-standard cancellation without retaining a caller reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Reports whether one caught value represents intentional cancellation. */
const isAbortError = isKnowledgeAbortError;

/** Re-proves every production dependency captured by this exact generation. */
function assertCoordinatorCurrent(state: Readonly<CoordinatorState>, signal?: AbortSignal): void {
  try {
    if (signal?.aborted) throw createAbortError();
    state.assertCurrent();
    KnowledgeRuntimeForwardRevisionStudioPort.assert(state.runtime);
    KnowledgeProductionForwardRevisionDecisionCoordinator.assertExecutionOwner(
      state.decisions,
      state.executionOwner
    );
    KnowledgeProductionForwardRevisionApplyCoordinator.assertExecutionOwner(
      state.apply,
      state.executionOwner
    );
    ObsidianKnowledgeCompilerTargetResolver.assert(state.targetVisitor);
    if (
      !KnowledgeRuntimeForwardRevisionStudioPort.matchesExecutionOwner(
        state.runtime,
        state.executionOwner
      ) ||
      !ObsidianKnowledgeCompilerTargetResolver.matchesExecutionOwner(
        state.targetVisitor,
        state.executionOwner
      )
    ) {
      throw createAbortError();
    }
    if (signal?.aborted) throw createAbortError();
  } catch {
    throw createAbortError();
  }
}

/** Returns hidden state only for one exact process-local coordinator receiver. */
function requireCoordinatorState(value: unknown): Readonly<CoordinatorState> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== KnowledgeProductionForwardRevisionStudioCoordinator.prototype
    ) {
      throw createAbortError();
    }
    const state = coordinatorStates.get(value);
    if (state) return state;
  } catch {
    throw createAbortError();
  }
  throw createAbortError();
}

/** Counts lines only to a fixed UI diff threshold. */
function hasBoundedInlineDiffLines(value: string): boolean {
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x0a) {
      lines += 1;
      if (lines > MAX_INLINE_DIFF_LINES) return false;
    }
  }
  return true;
}

/** Reports whether two complete texts may enter the line-diff display path. */
function canCreateInlineDiff(beforeContent: string, afterContent: string): boolean {
  return (
    beforeContent.length + afterContent.length <= MAX_INLINE_DIFF_CHARACTERS &&
    hasBoundedInlineDiffLines(beforeContent) &&
    hasBoundedInlineDiffLines(afterContent)
  );
}

/** Deeply freezes display-only diff blocks returned by the pure Review helper. */
function freezeReviewBlocks(
  value: readonly KnowledgeReviewBlock[]
): readonly KnowledgeReviewBlock[] {
  return Object.freeze(
    value.map((block) =>
      Object.freeze({
        ...block,
        parts: Object.freeze(
          block.parts.map((part) => Object.freeze({ ...part }))
        ) as unknown as KnowledgeReviewBlock["parts"],
      })
    )
  );
}

/** Produces one UI-only hash that is never accepted as a durable protocol digest. */
function digestUiIdentity(namespace: string, value: JsonValue): string {
  return sha256(`${namespace}\u0000${canonicalizeJson(value)}`);
}

/** Compares two already bounded protocol values without retaining caller aliases. */
function exactProtocolValuesEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
  } catch {
    return false;
  }
}

/** Builds one exact single-file render plan without constructing a legacy ChangeSet. */
function createPendingRenderPlan(
  record: Readonly<KnowledgeForwardRevisionStudioPendingRecord>,
  observation: Readonly<CurrentObservation>,
  productSnapshotRef: string
): Readonly<KnowledgeReviewPlan> {
  const proposal = record.proposal;
  const request = proposal.request;
  const expectedHash = request.intent.current.vaultObservedBeforeHash;
  const integrity =
    observation.kind === "file"
      ? observation.contentHash === expectedHash
        ? ("current" as const)
        : ("stale" as const)
      : observation.kind;
  const beforeContent = observation.kind === "file" ? observation.content : undefined;
  const changeId = `forward-studio-change-${digestUiIdentity("forward-studio-change-v1", {
    reviewRef: record.reviewRef,
    productSnapshotRef,
  })}`;
  const diffAllowed =
    integrity === "current" &&
    beforeContent !== undefined &&
    canCreateInlineDiff(beforeContent, request.selectedContent);
  const blocks = freezeReviewBlocks(
    diffAllowed ? createKnowledgeReviewBlocks(changeId, beforeContent, request.selectedContent) : []
  );
  const capability =
    integrity === "current"
      ? diffAllowed
        ? ("blocks_allowed" as const)
        : ("exact_only" as const)
      : ("reject_only" as const);
  const blockedReason =
    integrity === "current"
      ? undefined
      : integrity === "stale"
        ? "forward_revision_current_page_changed"
        : integrity === "missing"
          ? "forward_revision_current_page_missing"
          : integrity === "directory"
            ? "forward_revision_target_is_directory"
            : integrity === "occupied"
              ? "forward_revision_target_occupied"
              : "forward_revision_target_unavailable";
  const sourceRefs = Object.freeze([
    ...request.historicalReviewAuthority.targetChange.sourceRefs,
  ]) as unknown as string[];
  const file: KnowledgeReviewFile = Object.freeze({
    changeId,
    path: request.pagePath,
    operation: "update" as const,
    reason:
      "Reapply a previously verified output only after fresh deterministic validation and an exact file compare-and-swap.",
    sourceRefs,
    integrity,
    capability,
    ...(blockedReason === undefined ? {} : { blockedReason }),
    ...(beforeContent === undefined ? {} : { beforeContent }),
    afterContent: request.selectedContent,
    blocks: blocks as KnowledgeReviewBlock[],
  });
  const proposalDigest = digestUiIdentity("forward-studio-ui-proposal-v1", {
    reviewRef: record.reviewRef,
    productSnapshotRef,
  });
  const snapshotToken = digestUiIdentity("forward-studio-ui-snapshot-v1", {
    proposalDigest,
    currentKind: observation.kind,
    currentHash: observation.kind === "file" ? observation.contentHash : null,
  });
  return Object.freeze({
    changeSetId: record.reviewRef,
    bundleId: request.bundleId,
    proposalDigest,
    snapshotToken,
    operation: "ingest" as const,
    sourceRefs,
    validation: Object.freeze({
      okfValid: false,
      citationsValid: false,
      linksValid: false,
    }),
    createdAt: proposal.recordedAt,
    evidence: Object.freeze([]),
    omittedEvidenceCount: 0,
    files: Object.freeze([file]) as unknown as KnowledgeReviewFile[],
  });
}

/** Captures one pending target through the owner-bound bounded Vault visitor. */
async function observePendingTarget(
  state: Readonly<CoordinatorState>,
  record: Readonly<KnowledgeForwardRevisionStudioPendingRecord>,
  signal: AbortSignal
): Promise<Readonly<CurrentObservation>> {
  const request: Readonly<CompilerTargetRequest> = Object.freeze({
    targetId: `forward-studio-target-${record.reviewRef.slice("forward-studio-review-".length)}`,
    path: record.pagePath,
    intent: "write",
    access: "authorized",
  });
  let observation: Readonly<CurrentObservation> | undefined;
  let visits = 0;
  try {
    await state.targetVisitor.visit(
      Object.freeze([request]),
      signal,
      Object.freeze({ maxFileBytes: MAX_WIKI_PAGE_BYTES }),
      (value: CompilerTargetObservation, fileByteSize?: number) => {
        visits += 1;
        if (visits !== 1 || value.targetId !== request.targetId) throw new TypeError();
        if (value.kind === "file") {
          if (
            value.path !== record.pagePath ||
            !Number.isSafeInteger(fileByteSize) ||
            Number(fileByteSize) < 0 ||
            Number(fileByteSize) > MAX_WIKI_PAGE_BYTES ||
            value.content.length > MAX_WIKI_PAGE_CHARACTERS ||
            new TextEncoder().encode(value.content).byteLength !== fileByteSize
          ) {
            throw new TypeError();
          }
          observation = Object.freeze({
            kind: "file" as const,
            content: value.content,
            contentHash: createFileContentHash(value.content),
            byteSize: Number(fileByteSize),
          });
          return;
        }
        if (fileByteSize !== undefined) throw new TypeError();
        observation = Object.freeze({ kind: value.kind });
      }
    );
    assertCoordinatorCurrent(state, signal);
    if (visits !== 1 || !observation) throw new TypeError();
    return observation;
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw createAbortError();
    assertCoordinatorCurrent(state, signal);
    return Object.freeze({ kind: "unavailable" as const });
  }
}

/** Creates a product snapshot reference that additionally binds fresh Vault observation. */
function createProductSnapshotRef(
  record: Readonly<KnowledgeForwardRevisionStudioActiveRecord>,
  observation?: Readonly<CurrentObservation>
): string {
  return `forward-studio-snapshot-${digestUiIdentity("forward-studio-product-snapshot-v1", {
    runtimeSnapshotRef: record.snapshotRef,
    observation:
      observation === undefined
        ? null
        : observation.kind === "file"
          ? { kind: observation.kind, contentHash: observation.contentHash }
          : { kind: observation.kind },
  })}`;
}

/** Removes all durable command material while retaining bounded display fields. */
function projectNonPendingUiRecord(
  record: Exclude<KnowledgeForwardRevisionStudioActiveRecord, { state: "pending" }>,
  snapshotRef: string
): Readonly<KnowledgeForwardRevisionStudioReview> {
  const base = {
    reviewRef: record.reviewRef,
    snapshotRef,
    pagePath: record.pagePath,
    updatedAt: record.updatedAt,
    acceptedAt: record.acceptedAt,
    manualOverride: record.manualOverride,
  };
  if (record.state === "accepted_ready") {
    return Object.freeze({ state: "accepted_ready" as const, ...base });
  }
  if (record.state === "abandoned") {
    return Object.freeze({
      state: "abandoned" as const,
      ...base,
      abandonedAt: record.abandonedAt,
    });
  }
  if (record.state === "kept_current") {
    return Object.freeze({
      state: "kept_current" as const,
      ...base,
      terminalizedAt: record.terminalizedAt,
      outcome: record.outcome,
    });
  }
  if (record.state === "applying") {
    return Object.freeze({ state: "applying" as const, ...base, applyPhase: record.applyPhase });
  }
  return Object.freeze({
    state: "recovery_required" as const,
    ...base,
    conflictCode: record.conflictCode,
    actualKind: record.actualKind,
    detectedAt: record.detectedAt,
  });
}

/** Projects one stable Runtime snapshot and its bounded current-page observations. */
async function projectUiSnapshot(
  state: Readonly<CoordinatorState>,
  bundleId: string,
  signal: AbortSignal
): Promise<Readonly<ProjectedUiState>> {
  for (let attempt = 0; attempt < MAX_CONSISTENCY_ATTEMPTS; attempt += 1) {
    assertCoordinatorCurrent(state, signal);
    const before = snapshotKnowledgeForwardRevisionStudioSnapshot(
      await state.runtime.readForwardRevisionStudioBundle(bundleId)
    );
    assertCoordinatorCurrent(state, signal);
    const observations = new Map<string, Readonly<CurrentObservation>>();
    let totalObservationBytes = 0;
    let totalObservationCharacters = 0;
    for (const record of before.activeRecords) {
      if (record.state === "pending") {
        const observation = await observePendingTarget(state, record, signal);
        if (observation.kind === "file") {
          totalObservationBytes += observation.byteSize;
          totalObservationCharacters += observation.content.length;
          if (
            totalObservationBytes > MAX_TOTAL_WIKI_PAGE_BYTES ||
            totalObservationCharacters > MAX_TOTAL_WIKI_PAGE_CHARACTERS
          ) {
            throw new TypeError("Forward revision Studio observations exceed the product budget");
          }
        }
        observations.set(record.reviewRef, observation);
      }
    }
    const after = snapshotKnowledgeForwardRevisionStudioSnapshot(
      await state.runtime.readForwardRevisionStudioBundle(bundleId)
    );
    assertCoordinatorCurrent(state, signal);
    if (before.revisionToken !== after.revisionToken) continue;

    const bindings = new Map<string, Readonly<HiddenReviewBinding>>();
    const reviews = after.activeRecords.map(
      (record): Readonly<KnowledgeForwardRevisionStudioReview> => {
        const observation = observations.get(record.reviewRef);
        if (record.state === "pending" && observation === undefined) throw new TypeError();
        const productSnapshotRef = createProductSnapshotRef(record, observation);
        const ui: Readonly<KnowledgeForwardRevisionStudioReview> =
          record.state === "pending"
            ? Object.freeze({
                state: "pending" as const,
                reviewRef: record.reviewRef,
                snapshotRef: productSnapshotRef,
                pagePath: record.pagePath,
                updatedAt: record.updatedAt,
                requestedAt: record.requestedAt,
                selectedAppliedAt: record.selectedAppliedAt,
                plan: createPendingRenderPlan(record, observation!, productSnapshotRef),
              })
            : projectNonPendingUiRecord(record, productSnapshotRef);
        if (bindings.has(ui.reviewRef)) throw new TypeError();
        bindings.set(
          ui.reviewRef,
          Object.freeze({
            bundleId,
            runtimeRevision: after.runtimeRevision,
            durable: record,
            ui,
          })
        );
        return ui;
      }
    );
    const revisionToken = `forward-studio-ui-revision-${digestUiIdentity(
      "forward-studio-ui-revision-v1",
      {
        runtimeRevisionToken: after.revisionToken,
        rows: reviews.map((review) => ({
          reviewRef: review.reviewRef,
          snapshotRef: review.snapshotRef,
          state: review.state,
        })),
      }
    )}`;
    return Object.freeze({
      snapshot: Object.freeze({
        bundleId,
        runtimeRevision: after.runtimeRevision,
        revisionToken,
        reviews: Object.freeze(reviews),
      }),
      rows: bindings,
    });
  }
  throw new TypeError("Forward revision Studio snapshot did not stabilize");
}

/** Builds the scalar Apply request retained only behind the product coordinator. */
function createApplyRequest(record: Readonly<KnowledgeForwardRevisionStudioAcceptedReadyRecord>) {
  const decision = record.acceptedDecision;
  const proposal = decision.proposal;
  return Object.freeze({
    runtimeId: proposal.request.runtimeId,
    bundleId: proposal.request.bundleId,
    pagePath: proposal.request.pagePath,
    proposalId: proposal.proposalId,
    proposalDigest: decision.proposalDigest,
    acceptedDecisionDigest: decision.acceptedDecisionDigest,
    applyClaimId: decision.applyClaim.claimId,
    applyClaimDigest: decision.applyClaimDigest,
  });
}

/** Maps one durable journal convergence result to the value-only product result. */
function projectApplyResult(
  result: Readonly<KnowledgeProductionForwardRevisionApplyRecoveryResult>
): Readonly<KnowledgeForwardRevisionStudioSubmissionResult> {
  switch (result.kind) {
    case "committed":
      return APPLIED_RESULT;
    case "recovery_required":
      return RECOVERY_REQUIRED_RESULT;
    case "kept_current":
      return KEPT_CURRENT_RESULT;
    case "in_progress":
      return APPLYING_RESULT;
    case "idle":
      return STALE_RESULT;
  }
}

/** Reads the exact durable state for one opaque Review identity after a race or retry. */
async function readDurableReviewState(
  state: Readonly<CoordinatorState>,
  bundleId: string,
  reviewRef: string,
  expectedDecisionDigest?: string
): Promise<Readonly<KnowledgeForwardRevisionStudioActiveRecord> | "committed" | undefined> {
  const snapshot = snapshotKnowledgeForwardRevisionStudioSnapshot(
    await state.runtime.readForwardRevisionStudioBundle(bundleId)
  );
  const current = snapshot.activeRecords.find((record) => record.reviewRef === reviewRef);
  if (
    current &&
    expectedDecisionDigest !== undefined &&
    (current.state === "pending" || current.decisionDigest !== expectedDecisionDigest)
  ) {
    return undefined;
  }
  if (current) return current;
  return snapshot.committedReviewRefs.includes(reviewRef) ? "committed" : undefined;
}

/** Maps one freshly re-read durable Review state without trusting the prior operation result. */
function projectDurableReviewState(
  current: Readonly<KnowledgeForwardRevisionStudioActiveRecord> | "committed" | undefined
): Readonly<KnowledgeForwardRevisionStudioSubmissionResult> {
  if (current === "committed") return APPLIED_RESULT;
  if (!current || current.state === "pending") return STALE_RESULT;
  if (current.state === "accepted_ready") return ACCEPTED_READY_RESULT;
  if (current.state === "abandoned") return ABANDONED_RESULT;
  if (current.state === "kept_current") return KEPT_CURRENT_RESULT;
  if (current.state === "applying") return APPLYING_RESULT;
  return RECOVERY_REQUIRED_RESULT;
}

/** Runs one accepted-ready Apply and preserves that row on any pre-journal failure. */
async function applyAcceptedRecord(
  state: Readonly<CoordinatorState>,
  record: Readonly<KnowledgeForwardRevisionStudioAcceptedReadyRecord>,
  signal: AbortSignal
): Promise<Readonly<KnowledgeForwardRevisionStudioSubmissionResult>> {
  const bundleId = record.acceptedDecision.proposal.request.bundleId;
  try {
    const result = await state.apply.apply(createApplyRequest(record), signal);
    try {
      const current = await readDurableReviewState(
        state,
        bundleId,
        record.reviewRef,
        record.decisionDigest
      );
      if (current !== undefined) return projectDurableReviewState(current);
      return UNAVAILABLE_RESULT;
    } catch {
      return result.kind === "idle" ? UNAVAILABLE_RESULT : projectApplyResult(result);
    }
  } catch (error) {
    const code = KnowledgeForwardRevisionApplyCoordinatorError.inspect(error);
    try {
      const current = await readDurableReviewState(
        state,
        bundleId,
        record.reviewRef,
        record.decisionDigest
      );
      if (
        current === "committed" ||
        current?.state === "abandoned" ||
        current?.state === "kept_current" ||
        current?.state === "applying" ||
        current?.state === "recovery_required"
      ) {
        return projectDurableReviewState(current);
      }
      if (current?.state === "accepted_ready") {
        assertCoordinatorCurrent(state, signal);
        return ACCEPTED_READY_RESULT;
      }
    } catch (confirmationError) {
      if (signal.aborted || isAbortError(confirmationError)) {
        throw createAbortError();
      }
    }
    if (code === "aborted" || signal.aborted) throw createAbortError();
    assertCoordinatorCurrent(state, signal);
    if (code === "dependency_invalid") return UNAVAILABLE_RESULT;
    return UNAVAILABLE_RESULT;
  }
}

/** Rechecks one sticky recovery and projects only freshly re-read durable truth. */
async function resolveRecoveryRecord(
  state: Readonly<CoordinatorState>,
  record: Readonly<KnowledgeForwardRevisionStudioRecoveryRequiredRecord>,
  action: "retry_exact" | "keep_current",
  signal: AbortSignal
): Promise<Readonly<KnowledgeForwardRevisionStudioSubmissionResult>> {
  const bundleId = record.acceptedDecision.proposal.request.bundleId;
  let result: Readonly<KnowledgeProductionForwardRevisionApplyRecoveryResult> | undefined;
  try {
    result = await state.apply.resolveRecovery(record.recoveryExpectation, action, signal);
  } catch (error) {
    try {
      const current = await readDurableReviewState(
        state,
        bundleId,
        record.reviewRef,
        record.decisionDigest
      );
      if (current !== undefined) return projectDurableReviewState(current);
    } catch (confirmationError) {
      if (signal.aborted || isAbortError(confirmationError)) throw createAbortError();
    }
    if (signal.aborted || isAbortError(error)) throw createAbortError();
    assertCoordinatorCurrent(state, signal);
    return UNAVAILABLE_RESULT;
  }

  try {
    const current = await readDurableReviewState(
      state,
      bundleId,
      record.reviewRef,
      record.decisionDigest
    );
    return current === undefined ? projectApplyResult(result) : projectDurableReviewState(current);
  } catch {
    return projectApplyResult(result);
  }
}

/** Atomically abandons one accepted-ready identity and then reloads the exact durable winner. */
async function abandonAcceptedRecord(
  state: Readonly<CoordinatorState>,
  record: Readonly<KnowledgeForwardRevisionStudioAcceptedReadyRecord>,
  expectedRuntimeRevision: number,
  signal: AbortSignal
): Promise<Readonly<KnowledgeForwardRevisionStudioSubmissionResult>> {
  const bundleId = record.acceptedDecision.proposal.request.bundleId;
  const acceptedIdentity = createKnowledgeForwardRevisionStudioAcceptedIdentity(
    record.acceptedDecision
  );
  let committedAbandonment: Readonly<KnowledgeForwardRevisionAbandonmentRecordV1> | undefined;
  try {
    assertCoordinatorCurrent(state, signal);
    committedAbandonment = snapshotKnowledgeForwardRevisionAbandonmentRecord(
      await state.runtime.abandonForwardRevisionAcceptedReady(
        acceptedIdentity,
        expectedRuntimeRevision
      )
    );
    if (!exactProtocolValuesEqual(committedAbandonment.acceptedIdentity, acceptedIdentity)) {
      return UNAVAILABLE_RESULT;
    }
  } catch (error) {
    try {
      const current = await readDurableReviewState(
        state,
        bundleId,
        record.reviewRef,
        record.decisionDigest
      );
      if (
        current === "committed" ||
        current?.state === "abandoned" ||
        current?.state === "kept_current" ||
        current?.state === "applying" ||
        current?.state === "recovery_required"
      ) {
        return projectDurableReviewState(current);
      }
      if (current === undefined || current.state === "pending") return STALE_RESULT;
    } catch (confirmationError) {
      if (signal.aborted || isAbortError(confirmationError)) throw createAbortError();
    }
    if (signal.aborted || isAbortError(error)) throw createAbortError();
    assertCoordinatorCurrent(state, signal);
    return UNAVAILABLE_RESULT;
  }

  try {
    const current = await readDurableReviewState(
      state,
      bundleId,
      record.reviewRef,
      record.decisionDigest
    );
    if (
      current !== "committed" &&
      current?.state === "abandoned" &&
      current.abandonmentDigest === committedAbandonment.abandonmentDigest &&
      exactProtocolValuesEqual(current.abandonment, committedAbandonment)
    ) {
      return ABANDONED_RESULT;
    }
    return UNAVAILABLE_RESULT;
  } catch {
    return ABANDONED_RESULT;
  }
}

/** Resolves one partial selection only against the exact hidden render plan. */
function createPendingDecisionCommand(
  binding: Readonly<HiddenReviewBinding>,
  command: Readonly<KnowledgeForwardRevisionStudioCommand>
): Readonly<KnowledgeForwardRevisionReviewCommandV1> {
  if (binding.durable.state !== "pending" || binding.ui.state !== "pending") {
    throw new TypeError();
  }
  const durable = binding.durable;
  const proposal = durable.proposal;
  if (
    command.action === "apply" ||
    command.action === "abandon" ||
    command.action === "retry_recovery" ||
    command.action === "keep_current"
  ) {
    throw new TypeError();
  }
  if (command.action === "reject" || command.action === "accept_exact") {
    return createKnowledgeForwardRevisionReviewCommand({
      action: command.action,
      proposal,
      proposalDigest: durable.proposalDigest,
    });
  }
  let afterContent: string;
  if (command.action === "accept_edited") {
    afterContent = command.afterContent;
  } else {
    if (command.action !== "accept_blocks" || !("acceptedBlockIds" in command)) {
      throw new TypeError();
    }
    const file = binding.ui.plan.files[0];
    if (file.capability !== "blocks_allowed") {
      throw new TypeError();
    }
    const changeBlocks = new Set(
      file.blocks.filter((block) => block.kind === "change").map((block) => block.blockId)
    );
    if (command.acceptedBlockIds.some((blockId) => !changeBlocks.has(blockId))) {
      throw new TypeError();
    }
    afterContent = composeKnowledgeReviewSelectedContent(file, new Set(command.acceptedBlockIds));
  }
  return createKnowledgeForwardRevisionReviewCommand(
    afterContent === proposal.request.selectedContent
      ? { action: "accept_exact", proposal, proposalDigest: durable.proposalDigest }
      : {
          action: "accept_edited",
          proposal,
          proposalDigest: durable.proposalDigest,
          afterContent,
        }
  );
}

/** Finds the accepted product state created by one just-completed decision. */
async function continueAcceptedDecision(
  state: Readonly<CoordinatorState>,
  bundleId: string,
  reviewRef: string,
  decisionDigest: string,
  signal: AbortSignal
): Promise<Readonly<KnowledgeForwardRevisionStudioSubmissionResult>> {
  let current: Readonly<KnowledgeForwardRevisionStudioActiveRecord> | "committed" | undefined;
  try {
    current = await readDurableReviewState(state, bundleId, reviewRef, decisionDigest);
  } catch {
    return ACCEPTED_READY_RESULT;
  }
  if (current === "committed") return APPLIED_RESULT;
  if (!current) return STALE_RESULT;
  if (current.state === "abandoned") return ABANDONED_RESULT;
  if (current.state === "kept_current") return KEPT_CURRENT_RESULT;
  if (current.state === "accepted_ready") {
    try {
      assertCoordinatorCurrent(state, signal);
    } catch {
      return ACCEPTED_READY_RESULT;
    }
    return applyAcceptedRecord(state, current, signal);
  }
  if (current.state === "applying") return APPLYING_RESULT;
  if (current.state === "recovery_required") return RECOVERY_REQUIRED_RESULT;
  return STALE_RESULT;
}

/** Production coordinator for opaque Forward Review display, decision, and Apply. */
export class KnowledgeProductionForwardRevisionStudioCoordinator implements KnowledgeForwardRevisionStudioPort {
  /** Captures one exact production owner and its genuine read/decision/Apply boundaries. */
  constructor(
    runtime: KnowledgeRuntimeForwardRevisionStudioPort,
    decisions: KnowledgeProductionForwardRevisionDecisionCoordinator,
    apply: KnowledgeProductionForwardRevisionApplyCoordinator,
    targetVisitor: ObsidianKnowledgeCompilerTargetResolver,
    executionOwner: KnowledgeExecutionOwner,
    assertCurrent: () => void
  ) {
    try {
      KnowledgeExecutionOwner.assert(executionOwner);
      if (typeof assertCurrent !== "function") throw new TypeError();
      KnowledgeRuntimeForwardRevisionStudioPort.assert(runtime);
      const productionRuntime = runtime as ProductionForwardRevisionStudioRuntime;
      if (typeof productionRuntime.abandonForwardRevisionAcceptedReady !== "function") {
        throw new TypeError();
      }
      const state: Readonly<CoordinatorState> = Object.freeze({
        runtime: productionRuntime,
        decisions,
        apply,
        targetVisitor,
        executionOwner,
        assertCurrent,
        cache: { bundles: new Map() },
      });
      assertCoordinatorCurrent(state);
      coordinatorStates.set(this, state);
      Object.freeze(this);
    } catch {
      throw createAbortError();
    }
  }

  /** Requires one live exact process-local production coordinator. */
  static assert(
    value: unknown
  ): asserts value is KnowledgeProductionForwardRevisionStudioCoordinator {
    const state = requireCoordinatorState(value);
    assertCoordinatorCurrent(state);
  }

  /** Requires one live exact coordinator owned by the supplied execution lifecycle. */
  static assertExecutionOwner(value: unknown, executionOwner: unknown): void {
    try {
      KnowledgeExecutionOwner.assert(executionOwner);
      const state = requireCoordinatorState(value);
      assertCoordinatorCurrent(state);
      if (state.executionOwner !== executionOwner) throw createAbortError();
    } catch {
      throw createAbortError();
    }
  }

  /** Loads and privately binds one stable Runtime/Vault Forward Review projection. */
  async loadForwardRevisionStudio(
    bundleId: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionStudioUiSnapshot>> {
    const state = requireCoordinatorState(this);
    const bundleCache = retainBundleCache(state, bundleId);
    const sequence = bundleCache.sequence + 1;
    bundleCache.sequence = sequence;
    const projected = await projectUiSnapshot(state, bundleId, signal);
    if (bundleCache.sequence !== sequence) throw createAbortError();
    bundleCache.rows = projected.rows;
    return projected.snapshot;
  }

  /** Submits one current opaque row action through the distinct forward protocol. */
  async submitForwardRevisionStudio(
    bundleId: string,
    commandValue: KnowledgeForwardRevisionStudioCommand,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionStudioSubmissionResult>> {
    const state = requireCoordinatorState(this);
    assertCoordinatorCurrent(state, signal);
    let command: Readonly<KnowledgeForwardRevisionStudioCommand>;
    try {
      command = snapshotKnowledgeForwardRevisionStudioCommand(commandValue);
    } catch {
      return STALE_RESULT;
    }
    const binding = state.cache.bundles.get(bundleId)?.rows.get(command.reviewRef);
    if (
      !binding ||
      binding.bundleId !== bundleId ||
      binding.ui.snapshotRef !== command.snapshotRef ||
      binding.durable.pagePath !== binding.ui.pagePath ||
      (binding.durable.state === "pending"
        ? binding.durable.proposal.request.bundleId !== bundleId
        : binding.durable.acceptedDecision.proposal.request.bundleId !== bundleId)
    ) {
      return STALE_RESULT;
    }
    if (binding.durable.state === "accepted_ready") {
      if (command.action === "apply") {
        return applyAcceptedRecord(state, binding.durable, signal);
      }
      if (command.action === "abandon") {
        return abandonAcceptedRecord(state, binding.durable, binding.runtimeRevision, signal);
      }
      return STALE_RESULT;
    }
    if (binding.durable.state === "recovery_required") {
      if (command.action === "retry_recovery") {
        return resolveRecoveryRecord(state, binding.durable, "retry_exact", signal);
      }
      if (command.action === "keep_current") {
        return resolveRecoveryRecord(state, binding.durable, "keep_current", signal);
      }
      return STALE_RESULT;
    }
    if (
      binding.durable.state !== "pending" ||
      command.action === "apply" ||
      command.action === "abandon" ||
      command.action === "retry_recovery" ||
      command.action === "keep_current"
    ) {
      return STALE_RESULT;
    }

    let decisionCommand: Readonly<KnowledgeForwardRevisionReviewCommandV1>;
    try {
      decisionCommand = createPendingDecisionCommand(binding, command);
    } catch {
      return STALE_RESULT;
    }
    const result = await state.decisions.decide(decisionCommand, signal);
    switch (result.kind) {
      case "rejected":
        return REJECTED_RESULT;
      case "no_change":
        return NO_CHANGE_RESULT;
      case "stale":
        return STALE_RESULT;
      case "unavailable":
        return UNAVAILABLE_RESULT;
      case "accepted":
        return continueAcceptedDecision(
          state,
          bundleId,
          binding.durable.reviewRef,
          result.decisionDigest,
          signal
        );
    }
  }
}

Object.freeze(KnowledgeProductionForwardRevisionStudioCoordinator.prototype);
Object.freeze(KnowledgeProductionForwardRevisionStudioCoordinator);
