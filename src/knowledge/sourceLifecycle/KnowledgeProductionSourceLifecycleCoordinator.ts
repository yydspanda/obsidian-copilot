import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  KnowledgeSourceRetirementConflictError,
  type KnowledgeRuntimeStore,
  type KnowledgeSourceRetirementBlocker,
  type KnowledgeSourceRetirementCandidate,
  type KnowledgeSourceRetirementCandidateSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KnowledgeSourceLifecycleError,
  type KnowledgeSourceLifecyclePort,
  type KnowledgeSourceRetirementRequest,
  type KnowledgeSourceRetirementUiReceipt,
} from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import type { KnowledgeSourceObservationRecoverableIssue } from "@/knowledge/startup/KnowledgeSourceObservationStartupCoordinator";
import {
  createKnowledgeSourceLifecycleModel,
  type KnowledgeSourceLifecycleIssueReason,
  type KnowledgeSourceLifecycleItem,
  type KnowledgeSourceLifecycleModel,
} from "@/knowledge/ui/sourceLifecycleModel";

const MAX_SOURCE_LIFECYCLE_ITEMS = 10_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RETIREMENT_ID_PATTERN = /^knowledge-source-retirement-[a-f0-9]{64}$/;
/** Exact production dependencies retained by one source-lifecycle generation. */
export interface KnowledgeProductionSourceLifecycleCoordinatorInput {
  runtime: Pick<KnowledgeRuntimeStore, "readSourceRetirementCandidates" | "retireSourceAtomically">;
  getSourceIssues(): readonly KnowledgeSourceObservationRecoverableIssue[];
  assertCurrent(): void;
  onGenerationRefreshRequired(): void;
}

interface LifecycleStateSnapshot {
  readonly retirement: Readonly<KnowledgeSourceRetirementCandidateSnapshot>;
  readonly issues: readonly Readonly<KnowledgeSourceObservationRecoverableIssue>[];
}

interface RetirementReceiptProjection {
  readonly outcome: "retired" | "already_retired";
  readonly generatedPageCount: number;
}

const RETIREMENT_BLOCKERS = new Set<KnowledgeSourceRetirementBlocker>([
  "active_transaction",
  "bundle_work_active",
  "bundle_rerun_pending",
  "bundle_review_pending",
  "bundle_apply_pending",
  "bundle_apply_recovery_required",
  "source_observation_pending",
  "revision_overflow",
]);

/** Creates the standard cancellation category for stale lifecycle work. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Recognizes cancellation without relying on one renderer realm. */
function isAbortError(error: unknown): boolean {
  try {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "AbortError"
    );
  } catch {
    return false;
  }
}

/** Compares stable text without locale-dependent ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Creates an unambiguous Bundle/source lookup key. */
function createSourceKey(bundleId: string, sourceId: string): string {
  return `${bundleId.length}:${bundleId}${sourceId.length}:${sourceId}`;
}

/** Requires a non-empty opaque identifier without reflecting invalid content. */
function requireIdentifier(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KnowledgeSourceLifecycleError("invalid_request");
  }
  return value;
}

/** Requires caller cancellation and production generation authority together. */
function assertCurrent(signal: AbortSignal, assertGenerationCurrent: () => void): void {
  if (signal.aborted) throw createAbortError();
  try {
    assertGenerationCurrent();
  } catch {
    throw createAbortError();
  }
  if (signal.aborted) throw createAbortError();
}

/** Copies an exact plain data record without invoking accessors. */
function snapshotExactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  let prototype: object | null;
  let ownKeys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    !keys.every((key) => ownKeys.includes(key))
  ) {
    return undefined;
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

/** Copies a dense bounded array of unknown values without retaining its container. */
function snapshotDenseArray(value: unknown): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_SOURCE_LIFECYCLE_ITEMS ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new KnowledgeSourceLifecycleError("unavailable");
  }
  const items: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new KnowledgeSourceLifecycleError("unavailable");
    }
    items.push(descriptor.value);
  }
  return Object.freeze(items);
}

/** Copies and validates one Runtime retirement blocker list. */
function snapshotRetirementBlockers(value: unknown): readonly KnowledgeSourceRetirementBlocker[] {
  const blockers = snapshotDenseArray(value).map((blocker) => {
    if (!RETIREMENT_BLOCKERS.has(blocker as KnowledgeSourceRetirementBlocker)) {
      throw new KnowledgeSourceLifecycleError("unavailable");
    }
    return blocker as KnowledgeSourceRetirementBlocker;
  });
  blockers.sort(compareText);
  if (new Set(blockers).size !== blockers.length) {
    throw new KnowledgeSourceLifecycleError("unavailable");
  }
  return Object.freeze(blockers);
}

/** Copies one strict active Runtime retirement candidate. */
function snapshotRetirementCandidate(value: unknown): Readonly<KnowledgeSourceRetirementCandidate> {
  const snapshot = snapshotExactRecord(value, [
    "sourceId",
    "sourcePath",
    "custody",
    "generatedPageCount",
    "status",
    "expectedToken",
    "blockers",
  ]);
  const parsedPath = parseVaultPath(snapshot?.sourcePath);
  const blockers = snapshot ? snapshotRetirementBlockers(snapshot.blockers) : undefined;
  if (
    !snapshot ||
    typeof snapshot.sourceId !== "string" ||
    snapshot.sourceId.trim().length === 0 ||
    !parsedPath.ok ||
    parsedPath.path !== snapshot.sourcePath ||
    (snapshot.custody !== "user_managed" && snapshot.custody !== "managed_copy") ||
    !Number.isSafeInteger(snapshot.generatedPageCount) ||
    (snapshot.generatedPageCount as number) < 0 ||
    (snapshot.status !== "ready" && snapshot.status !== "blocked") ||
    typeof snapshot.expectedToken !== "string" ||
    !SHA256_PATTERN.test(snapshot.expectedToken) ||
    !blockers ||
    (snapshot.status === "ready") !== (blockers.length === 0)
  ) {
    throw new KnowledgeSourceLifecycleError("unavailable");
  }
  return Object.freeze({
    sourceId: snapshot.sourceId,
    sourcePath: snapshot.sourcePath,
    custody: snapshot.custody,
    generatedPageCount: snapshot.generatedPageCount as number,
    status: snapshot.status,
    expectedToken: snapshot.expectedToken,
    blockers,
  });
}

/** Copies one strict Runtime retirement candidate snapshot. */
function snapshotRetirementCandidates(
  value: unknown,
  expectedBundleId: string
): Readonly<KnowledgeSourceRetirementCandidateSnapshot> {
  const snapshot = snapshotExactRecord(value, [
    "bundleId",
    "runtimeRevision",
    "manifestRevision",
    "candidates",
  ]);
  if (
    !snapshot ||
    snapshot.bundleId !== expectedBundleId ||
    !Number.isSafeInteger(snapshot.runtimeRevision) ||
    (snapshot.runtimeRevision as number) < 0 ||
    !Number.isSafeInteger(snapshot.manifestRevision) ||
    (snapshot.manifestRevision as number) < 0
  ) {
    throw new KnowledgeSourceLifecycleError("unavailable");
  }
  const candidates = snapshotDenseArray(snapshot.candidates)
    .map(snapshotRetirementCandidate)
    .sort(
      (left, right) =>
        compareText(toWindowsPathKey(left.sourcePath), toWindowsPathKey(right.sourcePath)) ||
        compareText(left.sourcePath, right.sourcePath) ||
        compareText(left.sourceId, right.sourceId)
    );
  const sourceIds = new Set<string>();
  const sourceKeys = new Set<string>();
  const tokens = new Set<string>();
  for (const candidate of candidates) {
    const sourceKey = toWindowsPathKey(candidate.sourcePath);
    if (
      sourceIds.has(candidate.sourceId) ||
      sourceKeys.has(sourceKey) ||
      tokens.has(candidate.expectedToken)
    ) {
      throw new KnowledgeSourceLifecycleError("unavailable");
    }
    sourceIds.add(candidate.sourceId);
    sourceKeys.add(sourceKey);
    tokens.add(candidate.expectedToken);
  }
  return Object.freeze({
    bundleId: expectedBundleId,
    runtimeRevision: snapshot.runtimeRevision as number,
    manifestRevision: snapshot.manifestRevision as number,
    candidates: Object.freeze(candidates),
  });
}

/** Copies strict recoverable watcher issues without retaining coordinator values. */
function snapshotSourceIssues(
  value: unknown
): readonly Readonly<KnowledgeSourceObservationRecoverableIssue>[] {
  const issues: Readonly<KnowledgeSourceObservationRecoverableIssue>[] = snapshotDenseArray(
    value
  ).map((issue): Readonly<KnowledgeSourceObservationRecoverableIssue> => {
    const kind =
      typeof issue === "object" && issue !== null
        ? Object.getOwnPropertyDescriptor(issue, "kind")?.value
        : undefined;
    if (kind === "source_missing") {
      const snapshot = snapshotExactRecord(issue, ["kind", "bundleId", "sourceId"]);
      if (
        !snapshot ||
        typeof snapshot.bundleId !== "string" ||
        snapshot.bundleId.trim().length === 0 ||
        typeof snapshot.sourceId !== "string" ||
        snapshot.sourceId.trim().length === 0
      ) {
        throw new KnowledgeSourceLifecycleError("unavailable");
      }
      return Object.freeze({
        kind,
        bundleId: snapshot.bundleId,
        sourceId: snapshot.sourceId,
      });
    }
    if (kind === "source_change_unsupported") {
      const snapshot = snapshotExactRecord(issue, ["kind", "change", "bundleId", "sourceId"]);
      if (
        !snapshot ||
        (snapshot.change !== "delete" && snapshot.change !== "rename") ||
        typeof snapshot.bundleId !== "string" ||
        snapshot.bundleId.trim().length === 0 ||
        typeof snapshot.sourceId !== "string" ||
        snapshot.sourceId.trim().length === 0
      ) {
        throw new KnowledgeSourceLifecycleError("unavailable");
      }
      return Object.freeze({
        kind,
        change: snapshot.change,
        bundleId: snapshot.bundleId,
        sourceId: snapshot.sourceId,
      });
    }
    throw new KnowledgeSourceLifecycleError("unavailable");
  });
  issues.sort(
    (left, right) =>
      compareText(left.bundleId, right.bundleId) ||
      compareText(left.sourceId, right.sourceId) ||
      compareText(left.kind, right.kind) ||
      compareText(getIssueDetail(left), getIssueDetail(right))
  );
  return Object.freeze(issues);
}

/** Returns the stable detail discriminator of one recoverable source issue. */
function getIssueDetail(issue: Readonly<KnowledgeSourceObservationRecoverableIssue>): string {
  return issue.kind === "source_change_unsupported" ? issue.change : "";
}

/** Captures one exact token-bound retirement request. */
function snapshotRetirementRequest(
  value: Readonly<KnowledgeSourceRetirementRequest>
): Readonly<KnowledgeSourceRetirementRequest> {
  const snapshot = snapshotExactRecord(value, ["sourceId", "retirementRef", "reason"]);
  if (
    !snapshot ||
    typeof snapshot.sourceId !== "string" ||
    snapshot.sourceId.trim().length === 0 ||
    typeof snapshot.retirementRef !== "string" ||
    !SHA256_PATTERN.test(snapshot.retirementRef) ||
    (snapshot.reason !== "user_requested" && snapshot.reason !== "source_missing")
  ) {
    throw new KnowledgeSourceLifecycleError("invalid_request");
  }
  return Object.freeze({
    sourceId: snapshot.sourceId,
    retirementRef: snapshot.retirementRef,
    reason: snapshot.reason,
  });
}

/** Maps one recoverable watcher issue to its user-facing lifecycle reason. */
function mapIssueReason(
  issue: Readonly<KnowledgeSourceObservationRecoverableIssue>
): KnowledgeSourceLifecycleIssueReason {
  if (issue.kind === "source_missing") return "source_missing";
  return issue.change === "delete" ? "source_deleted" : "source_renamed";
}

/** Selects the strongest issue when one source accumulated several recoverable hints. */
function selectIssueReason(
  current: KnowledgeSourceLifecycleIssueReason | undefined,
  candidate: KnowledgeSourceLifecycleIssueReason
): KnowledgeSourceLifecycleIssueReason {
  const priority: Record<KnowledgeSourceLifecycleIssueReason, number> = {
    source_missing: 3,
    source_deleted: 2,
    source_renamed: 1,
  };
  return !current || priority[candidate] > priority[current] ? candidate : current;
}

/** Copies and validates only the retirement receipt fields exposed to the UI. */
function snapshotRetirementReceipt(
  value: unknown,
  bundleId: string,
  sourceId: string,
  sourcePath: string
): Readonly<RetirementReceiptProjection> {
  const snapshot = snapshotExactRecord(value, [
    "outcome",
    "bundleId",
    "sourceId",
    "sourcePath",
    "custody",
    "retirementId",
    "retiredAt",
    "manifestRevision",
    "runtimeRevision",
    "generatedPages",
  ]);
  if (
    !snapshot ||
    (snapshot.outcome !== "retired" && snapshot.outcome !== "already_retired") ||
    snapshot.bundleId !== bundleId ||
    snapshot.sourceId !== sourceId ||
    snapshot.sourcePath !== sourcePath ||
    (snapshot.custody !== "user_managed" && snapshot.custody !== "managed_copy") ||
    typeof snapshot.retirementId !== "string" ||
    !RETIREMENT_ID_PATTERN.test(snapshot.retirementId) ||
    !Number.isSafeInteger(snapshot.retiredAt) ||
    (snapshot.retiredAt as number) < 0 ||
    !Number.isSafeInteger(snapshot.manifestRevision) ||
    (snapshot.manifestRevision as number) < 0 ||
    !Number.isSafeInteger(snapshot.runtimeRevision) ||
    (snapshot.runtimeRevision as number) < 0
  ) {
    throw new KnowledgeSourceLifecycleError("source_changed");
  }
  const generatedPages = snapshotDenseArray(snapshot.generatedPages);
  return Object.freeze({
    outcome: snapshot.outcome,
    generatedPageCount: generatedPages.length,
  });
}

/**
 * Generation-bound source lifecycle coordinator with no Studio, worker, or Wiki authority.
 *
 * Retirement is delegated to the Runtime's token-bound atomic transition. This
 * boundary intentionally has no source-file publication authority.
 */
export class KnowledgeProductionSourceLifecycleCoordinator implements KnowledgeSourceLifecyclePort {
  private readonly assertGenerationCurrent: () => void;

  /** Captures one released production generation and its least-authority ports. */
  constructor(private readonly input: KnowledgeProductionSourceLifecycleCoordinatorInput) {
    this.assertGenerationCurrent = () => input.assertCurrent();
  }

  /** Loads active Runtime sources merged with current recoverable watcher issues. */
  async loadSources(
    bundleId: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceLifecycleModel>> {
    const exactBundleId = requireIdentifier(bundleId);
    try {
      const state = await this.readState(exactBundleId, signal);
      const issueReasons = this.createIssueReasonIndex(state, exactBundleId);
      const sources: KnowledgeSourceLifecycleItem[] = state.retirement.candidates.map(
        (candidate) => {
          const issueReason = issueReasons.get(createSourceKey(exactBundleId, candidate.sourceId));
          const canRemove = candidate.blockers.length === 0;
          if (!issueReason) {
            return {
              sourceId: candidate.sourceId,
              sourcePath: candidate.sourcePath,
              custody: candidate.custody,
              generatedPageCount: candidate.generatedPageCount,
              retirementRef: candidate.expectedToken,
              retirementBlockers: candidate.blockers,
              status: "ready" as const,
              actions: { canCheckAgain: false, canRemove },
            };
          }
          return {
            sourceId: candidate.sourceId,
            sourcePath: candidate.sourcePath,
            custody: candidate.custody,
            generatedPageCount: candidate.generatedPageCount,
            retirementRef: candidate.expectedToken,
            retirementBlockers: candidate.blockers,
            status: "missing" as const,
            issueReason,
            actions: {
              canCheckAgain: true,
              canRemove,
            },
          };
        }
      );
      return createKnowledgeSourceLifecycleModel({
        bundleId: exactBundleId,
        runtimeRevision: state.retirement.runtimeRevision,
        manifestRevision: state.retirement.manifestRevision,
        sources,
      });
    } catch (error) {
      return this.rethrowReadError(error);
    }
  }

  /** Requests one generation refresh only for a still-missing active source. */
  async checkAgain(bundleId: string, sourceId: string, signal: AbortSignal): Promise<void> {
    const exactBundleId = requireIdentifier(bundleId);
    const exactSourceId = requireIdentifier(sourceId);
    const state = await this.readState(exactBundleId, signal);
    const candidate = this.requireCandidate(state, exactBundleId, exactSourceId);
    if (!this.findIssue(state, exactBundleId, candidate.sourceId)) {
      throw new KnowledgeSourceLifecycleError("source_not_missing");
    }
    assertCurrent(signal, this.assertGenerationCurrent);
    this.requestGenerationRefresh();
  }

  /** Atomically retires one twice-reproved active source while preserving Wiki bytes. */
  async retireSource(
    bundleId: string,
    requestValue: Readonly<KnowledgeSourceRetirementRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceRetirementUiReceipt>> {
    const exactBundleId = requireIdentifier(bundleId);
    const request = snapshotRetirementRequest(requestValue);
    const initial = await this.readState(exactBundleId, signal);
    const initialCandidate = this.requireTokenCandidate(initial, exactBundleId, request);
    this.assertRetirementAllowed(initial, exactBundleId, initialCandidate, request.reason);

    const reproved = await this.readState(exactBundleId, signal);
    const candidate = this.requireTokenCandidate(reproved, exactBundleId, request);
    if (candidate.sourcePath !== initialCandidate.sourcePath) {
      throw new KnowledgeSourceLifecycleError("source_changed");
    }
    this.assertRetirementAllowed(reproved, exactBundleId, candidate, request.reason);
    assertCurrent(signal, this.assertGenerationCurrent);

    let receipt: Readonly<RetirementReceiptProjection>;
    try {
      receipt = snapshotRetirementReceipt(
        await this.input.runtime.retireSourceAtomically(
          Object.freeze({
            version: 1 as const,
            bundleId: exactBundleId,
            sourceId: request.sourceId,
            expectedToken: request.retirementRef,
            reason: request.reason,
            confirm: Object.freeze({
              keepWikiFiles: true as const,
              revokeProvenance: true as const,
              reserveIdentity: true as const,
            }),
          })
        ),
        exactBundleId,
        request.sourceId,
        candidate.sourcePath
      );
    } catch (error) {
      if (error instanceof KnowledgeSourceRetirementConflictError) {
        if (error.reason === "blocked") {
          throw new KnowledgeSourceLifecycleError("retirement_blocked");
        }
        if (error.reason === "request_invalid") {
          throw new KnowledgeSourceLifecycleError("invalid_request");
        }
        throw new KnowledgeSourceLifecycleError("source_changed");
      }
      if (isAbortError(error) || signal.aborted) throw createAbortError();
      if (error instanceof KnowledgeSourceLifecycleError) throw error;
      throw new KnowledgeSourceLifecycleError("source_changed");
    }
    this.requestGenerationRefreshBestEffort();
    return Object.freeze({
      outcome: receipt.outcome,
      retainedWikiPageCount: receipt.generatedPageCount,
    });
  }

  /** Reads and strictly snapshots Runtime plus recoverable watcher state. */
  private async readState(bundleId: string, signal: AbortSignal): Promise<LifecycleStateSnapshot> {
    assertCurrent(signal, this.assertGenerationCurrent);
    try {
      const retirement = snapshotRetirementCandidates(
        await this.input.runtime.readSourceRetirementCandidates(bundleId),
        bundleId
      );
      assertCurrent(signal, this.assertGenerationCurrent);
      const issues = snapshotSourceIssues(this.input.getSourceIssues());
      assertCurrent(signal, this.assertGenerationCurrent);
      return Object.freeze({ retirement, issues });
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw createAbortError();
      if (error instanceof KnowledgeSourceLifecycleError) throw error;
      throw new KnowledgeSourceLifecycleError("unavailable");
    }
  }

  /** Builds a strict issue index and rejects watcher/Runtime source disagreement. */
  private createIssueReasonIndex(
    state: LifecycleStateSnapshot,
    bundleId: string
  ): ReadonlyMap<string, KnowledgeSourceLifecycleIssueReason> {
    const candidateIds = new Set(
      state.retirement.candidates.map((candidate) => candidate.sourceId)
    );
    const reasons = new Map<string, KnowledgeSourceLifecycleIssueReason>();
    for (const issue of state.issues) {
      if (issue.bundleId !== bundleId) continue;
      if (!candidateIds.has(issue.sourceId)) {
        throw new KnowledgeSourceLifecycleError("unavailable");
      }
      const key = createSourceKey(issue.bundleId, issue.sourceId);
      reasons.set(key, selectIssueReason(reasons.get(key), mapIssueReason(issue)));
    }
    return reasons;
  }

  /** Finds one current recoverable issue for an exact Bundle/source pair. */
  private findIssue(
    state: LifecycleStateSnapshot,
    bundleId: string,
    sourceId: string
  ): Readonly<KnowledgeSourceObservationRecoverableIssue> | undefined {
    return state.issues.find((issue) => issue.bundleId === bundleId && issue.sourceId === sourceId);
  }

  /** Requires one active Runtime candidate from the same strict snapshot. */
  private requireCandidate(
    state: LifecycleStateSnapshot,
    bundleId: string,
    sourceId: string
  ): Readonly<KnowledgeSourceRetirementCandidate> {
    if (state.retirement.bundleId !== bundleId) {
      throw new KnowledgeSourceLifecycleError("source_changed");
    }
    const candidate = state.retirement.candidates.find((entry) => entry.sourceId === sourceId);
    if (!candidate) throw new KnowledgeSourceLifecycleError("source_changed");
    return candidate;
  }

  /** Requires an active candidate to retain the request's opaque retirement token. */
  private requireTokenCandidate(
    state: LifecycleStateSnapshot,
    bundleId: string,
    request: Pick<KnowledgeSourceRetirementRequest, "sourceId" | "retirementRef">
  ): Readonly<KnowledgeSourceRetirementCandidate> {
    const candidate = this.requireCandidate(state, bundleId, request.sourceId);
    if (candidate.expectedToken !== request.retirementRef) {
      throw new KnowledgeSourceLifecycleError("source_changed");
    }
    return candidate;
  }

  /** Re-proves reason-specific missing state and all atomic retirement blockers. */
  private assertRetirementAllowed(
    state: LifecycleStateSnapshot,
    bundleId: string,
    candidate: Readonly<KnowledgeSourceRetirementCandidate>,
    reason: KnowledgeSourceRetirementRequest["reason"]
  ): void {
    if (candidate.blockers.length > 0) {
      throw new KnowledgeSourceLifecycleError("retirement_blocked");
    }
    if (reason === "source_missing" && !this.findIssue(state, bundleId, candidate.sourceId)) {
      throw new KnowledgeSourceLifecycleError("source_not_missing");
    }
  }

  /** Requests exactly one generation refresh and maps callback failure safely. */
  private requestGenerationRefresh(): void {
    try {
      this.input.onGenerationRefreshRequired();
    } catch {
      throw new KnowledgeSourceLifecycleError("refresh_failed");
    }
  }

  /** Best-effort refresh after a durable commit; its failure cannot erase success. */
  private requestGenerationRefreshBestEffort(): void {
    try {
      this.input.onGenerationRefreshRequired();
    } catch {
      // The durable retirement receipt wins over an advisory refresh failure.
    }
  }

  /** Preserves only cancellation and stable lifecycle read errors. */
  private rethrowReadError(error: unknown): never {
    if (isAbortError(error)) throw createAbortError();
    if (error instanceof KnowledgeSourceLifecycleError) throw error;
    throw new KnowledgeSourceLifecycleError("unavailable");
  }
}

Object.freeze(KnowledgeProductionSourceLifecycleCoordinator.prototype);
Object.freeze(KnowledgeProductionSourceLifecycleCoordinator);
