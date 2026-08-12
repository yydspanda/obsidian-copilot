import type {
  CompilerTargetRequest,
  CompilerTargetResolver,
} from "@/knowledge/compiler/CompilerModelPort";
import { ObsidianKnowledgeCompilerTargetResolverError } from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import type { IngestQueueSnapshot } from "@/knowledge/ingest/queue/QueueStorage";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { KnowledgeBundleConfig, KnowledgeIngestJob } from "@/knowledge/model/types";
import {
  validateKnowledgeBundleConfig,
  validateKnowledgeChangeSet,
} from "@/knowledge/model/validation";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  createKnowledgeReviewPlan,
  type KnowledgeReviewCommand,
  type KnowledgeReviewPlan,
  type KnowledgeReviewTargetObservation,
} from "@/knowledge/review/ReviewDecision";
import type {
  ChangeSetReviewSnapshot,
  PendingChangeSetReviewRecord,
} from "@/knowledge/review/ReviewStorage";
import type {
  KnowledgeRuntimeStore,
  KnowledgeRuntimeStudioBundleSnapshot,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { deriveKnowledgeActivityModel } from "@/knowledge/ui/activityModel";
import type {
  KnowledgeStudioCommandPort,
  KnowledgeStudioReadPort,
  KnowledgeStudioRecoverySubmissionResult,
  KnowledgeStudioReviewSubmissionResult,
  KnowledgeStudioSnapshot,
} from "@/knowledge/ui/KnowledgeStudioController";
import type {
  KnowledgeStudioQueryResult,
  KnowledgeStudioQueryPort,
  KnowledgeStudioQueryRequest,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";
import type {
  KnowledgeStudioQueryWritebackPort,
  KnowledgeStudioQueryWritebackRequest,
  KnowledgeStudioQueryWritebackResult,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";
import {
  KnowledgeStudioAdapterUnavailableError,
  NO_KNOWLEDGE_STUDIO_COMMAND_CAPABILITIES,
} from "@/knowledge/ui/KnowledgeStudioController";
import { KnowledgeStudioRuntimeCommandAdapter } from "@/knowledge/ui/KnowledgeStudioRuntimeCommandAdapter";
import type { KnowledgeStudioReviewEvidencePort } from "@/knowledge/ui/KnowledgeStudioReviewEvidencePort";
import type { KnowledgeReviewEvidenceOpenRequest } from "@/knowledge/review/KnowledgeReviewEvidence";
import type {
  KnowledgeSourceLifecyclePort,
  KnowledgeSourceRetirementRequest,
  KnowledgeSourceRetirementUiReceipt,
} from "@/knowledge/sourceLifecycle/KnowledgeSourceLifecyclePort";
import { sha256 } from "@/utils/hash";

const DEFAULT_MAX_CONSISTENCY_ATTEMPTS = 3;
const MAX_REVIEW_TARGET_CHARACTERS = 20_000_000;

/** Narrow Runtime reads and hints required by the live Studio adapter. */
export type KnowledgeStudioRuntimePort = Pick<
  KnowledgeRuntimeStore,
  "readStudioBundle" | "subscribeStudioBundle"
>;

/** Optional generation-owned external hint source; callbacks carry no authoritative state. */
export type KnowledgeStudioVaultHintPort = (bundleId: string, onHint: () => void) => () => void;

/** Query capabilities accepted from one exact production generation. */
type KnowledgeStudioRuntimeQueryPort = Pick<
  KnowledgeStudioQueryPort,
  "query" | "openCitation" | "revokeCurrent"
> &
  Partial<Pick<KnowledgeStudioQueryWritebackPort, "saveQueryToWiki">> &
  Partial<Readonly<{ supportsWriteback(): boolean }>>;

/** Dependencies captured by one exact production Studio generation. */
export interface KnowledgeStudioRuntimeReadAdapterInput {
  runtime: KnowledgeStudioRuntimePort;
  bundles: readonly KnowledgeBundleConfig[];
  targetResolver: CompilerTargetResolver;
  assertCurrent(): void;
  commands?: KnowledgeStudioRuntimeCommandAdapter;
  query?: KnowledgeStudioRuntimeQueryPort;
  reviewEvidence?: KnowledgeStudioReviewEvidencePort;
  sourceLifecycle?: KnowledgeSourceLifecyclePort;
  subscribeVaultHints?: KnowledgeStudioVaultHintPort;
  maxConsistencyAttempts?: number;
}

/** Captures one evidence-navigation method without retaining an accessor. */
function captureReviewEvidencePort(value: unknown): KnowledgeStudioReviewEvidencePort {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeStudioRuntimeReadError();
  }
  const owner = value;
  let candidate: object | null = owner;
  const visited = new Set<object>();
  try {
    while (candidate && !visited.has(candidate)) {
      visited.add(candidate);
      const descriptor = Object.getOwnPropertyDescriptor(candidate, "openReviewEvidence");
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") {
          throw new KnowledgeStudioRuntimeReadError();
        }
        const openReviewEvidence = descriptor.value as (
          this: object,
          bundleId: string,
          request: Readonly<KnowledgeReviewEvidenceOpenRequest>,
          signal: AbortSignal
        ) => ReturnType<KnowledgeStudioReviewEvidencePort["openReviewEvidence"]>;
        return Object.freeze({
          openReviewEvidence: (
            bundleId: string,
            request: Readonly<KnowledgeReviewEvidenceOpenRequest>,
            signal: AbortSignal
          ) => Reflect.apply(openReviewEvidence, owner, [bundleId, request, signal]),
        });
      }
      candidate = Object.getPrototypeOf(candidate) as object | null;
    }
  } catch (error) {
    if (error instanceof KnowledgeStudioRuntimeReadError) throw error;
  }
  throw new KnowledgeStudioRuntimeReadError();
}

type KnowledgeSourceLifecycleMethodKey = "loadSources" | "checkAgain" | "retireSource";

/** Captures one lifecycle data method without invoking an accessor. */
function captureSourceLifecycleDataMethod(
  owner: object,
  key: KnowledgeSourceLifecycleMethodKey
): (...args: never[]) => unknown {
  try {
    let candidate: object | null = owner;
    const visited = new Set<object>();
    while (candidate && !visited.has(candidate)) {
      visited.add(candidate);
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") {
          throw new KnowledgeStudioRuntimeReadError();
        }
        return descriptor.value as (...args: never[]) => unknown;
      }
      candidate = Object.getPrototypeOf(candidate) as object | null;
    }
  } catch (error) {
    if (error instanceof KnowledgeStudioRuntimeReadError) throw error;
  }
  throw new KnowledgeStudioRuntimeReadError();
}

/** Snapshots one exact generation-owned source lifecycle capability. */
function captureSourceLifecyclePort(value: unknown): KnowledgeSourceLifecyclePort {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeStudioRuntimeReadError();
  }
  const owner = value;
  const loadSources = captureSourceLifecycleDataMethod(owner, "loadSources");
  const checkAgain = captureSourceLifecycleDataMethod(owner, "checkAgain");
  const retireSource = captureSourceLifecycleDataMethod(owner, "retireSource");
  return Object.freeze({
    loadSources: (bundleId: string, signal: AbortSignal) =>
      Reflect.apply(loadSources, owner, [bundleId, signal]) as Promise<
        Awaited<ReturnType<KnowledgeSourceLifecyclePort["loadSources"]>>
      >,
    checkAgain: (bundleId: string, sourceId: string, signal: AbortSignal) =>
      Reflect.apply(checkAgain, owner, [bundleId, sourceId, signal]) as Promise<void>,
    retireSource: (
      bundleId: string,
      request: Readonly<KnowledgeSourceRetirementRequest>,
      signal: AbortSignal
    ) =>
      Reflect.apply(retireSource, owner, [bundleId, request, signal]) as Promise<
        Readonly<KnowledgeSourceRetirementUiReceipt>
      >,
  });
}

/** Exact durable record, target read-set, and plan produced by one consistent observation. */
export interface KnowledgeStudioReviewContext {
  record: PendingChangeSetReviewRecord;
  observations: readonly KnowledgeReviewTargetObservation[];
  plan: KnowledgeReviewPlan;
}

/** Inputs required to reconstruct one exact command-time Review context. */
export interface KnowledgeStudioReviewContextLoadInput {
  runtime: KnowledgeStudioRuntimePort;
  bundle: KnowledgeBundleConfig;
  targetResolver: CompilerTargetResolver;
  changeSetId: string;
  signal: AbortSignal;
  assertCurrent(): void;
  maxConsistencyAttempts?: number;
}

/** Fixed read failure that never retains paths, file contents, or adapter causes. */
export class KnowledgeStudioRuntimeReadError extends Error {
  /** Creates one sanitized read-only adapter failure. */
  constructor() {
    super("Knowledge Studio could not construct a consistent Runtime snapshot");
    this.name = "KnowledgeStudioRuntimeReadError";
  }
}

interface CapturedKnowledgeStudioQueryState {
  readonly owner: object;
  readonly query: KnowledgeStudioQueryPort["query"];
  readonly openCitation: KnowledgeStudioQueryPort["openCitation"];
  readonly revokeCurrent: KnowledgeStudioQueryPort["revokeCurrent"];
  readonly saveQueryToWiki?: KnowledgeStudioQueryWritebackPort["saveQueryToWiki"];
}

const capturedKnowledgeStudioQueryStates = new WeakMap<object, CapturedKnowledgeStudioQueryState>();

/** Finds one callable data method without invoking an accessor. */
function captureQueryDataMethod(
  owner: object,
  key: "query" | "openCitation" | "revokeCurrent" | "saveQueryToWiki"
): (...args: never[]) => unknown {
  try {
    let candidate: object | null = owner;
    const visited = new Set<object>();
    while (candidate && !visited.has(candidate)) {
      visited.add(candidate);
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") {
          throw new KnowledgeStudioRuntimeReadError();
        }
        return descriptor.value as (...args: never[]) => unknown;
      }
      candidate = Object.getPrototypeOf(candidate) as object | null;
    }
  } catch (error) {
    if (error instanceof KnowledgeStudioRuntimeReadError) throw error;
  }
  throw new KnowledgeStudioRuntimeReadError();
}

/** Captures one optional data method without invoking an accessor. */
function captureOptionalQueryDataMethod(
  owner: object,
  key: "saveQueryToWiki"
): ((...args: never[]) => unknown) | undefined {
  try {
    let candidate: object | null = owner;
    const visited = new Set<object>();
    while (candidate && !visited.has(candidate)) {
      visited.add(candidate);
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") {
          throw new KnowledgeStudioRuntimeReadError();
        }
        return descriptor.value as (...args: never[]) => unknown;
      }
      candidate = Object.getPrototypeOf(candidate) as object | null;
    }
    return undefined;
  } catch (error) {
    if (error instanceof KnowledgeStudioRuntimeReadError) throw error;
    throw new KnowledgeStudioRuntimeReadError();
  }
}

/** Returns hidden state only for an authentic captured Query capability. */
function requireCapturedQueryState(value: object): CapturedKnowledgeStudioQueryState {
  const state = capturedKnowledgeStudioQueryStates.get(value);
  if (!state) throw new KnowledgeStudioRuntimeReadError();
  return state;
}

/** Immutable method snapshot that cannot be swapped through the caller's input object. */
class CapturedKnowledgeStudioQueryPort implements KnowledgeStudioRuntimeQueryPort {
  /** Captures exact data methods and their receiver without exposing them as properties. */
  constructor(owner: object) {
    const saveQueryToWiki = captureOptionalQueryDataMethod(owner, "saveQueryToWiki");
    capturedKnowledgeStudioQueryStates.set(this, {
      owner,
      query: captureQueryDataMethod(owner, "query") as unknown as KnowledgeStudioQueryPort["query"],
      openCitation: captureQueryDataMethod(
        owner,
        "openCitation"
      ) as unknown as KnowledgeStudioQueryPort["openCitation"],
      revokeCurrent: captureQueryDataMethod(owner, "revokeCurrent"),
      ...(saveQueryToWiki === undefined
        ? {}
        : {
            saveQueryToWiki:
              saveQueryToWiki as KnowledgeStudioQueryWritebackPort["saveQueryToWiki"],
          }),
    });
    Object.freeze(this);
  }

  /** Invokes the exact Query method captured for this adapter generation. */
  async query(
    bundleId: string,
    request: Readonly<KnowledgeStudioQueryRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryResult> {
    const state = requireCapturedQueryState(this);
    return Reflect.apply(state.query, state.owner, [bundleId, request, signal]);
  }

  /** Invokes the exact opaque citation method captured for this adapter generation. */
  async openCitation(
    bundleId: string,
    queryId: string,
    citationRef: string,
    signal: AbortSignal
  ): Promise<void> {
    const state = requireCapturedQueryState(this);
    return Reflect.apply(state.openCitation, state.owner, [bundleId, queryId, citationRef, signal]);
  }

  /** Invokes the exact synchronous revocation method captured for this generation. */
  revokeCurrent(bundleId: string, queryId?: string): void {
    const state = requireCapturedQueryState(this);
    const result = Reflect.apply(state.revokeCurrent, state.owner, [bundleId, queryId]);
    if (result !== undefined) throw new KnowledgeStudioRuntimeReadError();
  }

  /** Reports whether the captured generation exposed reviewed writeback. */
  supportsWriteback(): boolean {
    return requireCapturedQueryState(this).saveQueryToWiki !== undefined;
  }

  /** Invokes the exact current-answer capture method retained by this generation. */
  async saveQueryToWiki(
    bundleId: string,
    queryId: string,
    request: Readonly<KnowledgeStudioQueryWritebackRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryWritebackResult> {
    const state = requireCapturedQueryState(this);
    if (!state.saveQueryToWiki) throw new KnowledgeStudioAdapterUnavailableError();
    return Reflect.apply(state.saveQueryToWiki, state.owner, [bundleId, queryId, request, signal]);
  }
}

Object.freeze(CapturedKnowledgeStudioQueryPort.prototype);
Object.freeze(CapturedKnowledgeStudioQueryPort);

/** Captures an optional own Query data property without invoking a getter. */
function captureOptionalQueryPort(
  input: KnowledgeStudioRuntimeReadAdapterInput
): CapturedKnowledgeStudioQueryPort | undefined {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, "query");
  } catch {
    throw new KnowledgeStudioRuntimeReadError();
  }
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new KnowledgeStudioRuntimeReadError();
  const value: unknown = descriptor.value;
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeStudioRuntimeReadError();
  }
  return new CapturedKnowledgeStudioQueryPort(value);
}

/** Internal control signal requesting another complete atomic read. */
class KnowledgeStudioConsistencyRetry extends Error {
  /** Creates a value-free retry signal. */
  constructor() {
    super("Knowledge Studio state changed during observation");
    this.name = "KnowledgeStudioConsistencyRetry";
  }
}

/** Throws the platform cancellation category at every asynchronous boundary. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

/** Compares stable identifiers without locale-dependent ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Creates a detached strict Bundle map for one adapter generation. */
function snapshotBundles(
  bundles: readonly KnowledgeBundleConfig[]
): ReadonlyMap<string, KnowledgeBundleConfig> {
  const result = new Map<string, KnowledgeBundleConfig>();
  for (const bundle of bundles) {
    const validation = validateKnowledgeBundleConfig(bundle);
    if (!validation.valid || result.has(bundle.id)) {
      throw new KnowledgeStudioRuntimeReadError();
    }
    result.set(
      bundle.id,
      Object.freeze({
        ...bundle,
        sourceRoots: Object.freeze([...bundle.sourceRoots]) as unknown as string[],
      })
    );
  }
  if (result.size === 0) throw new KnowledgeStudioRuntimeReadError();
  return result;
}

/** Reports whether one Queue job exactly owns a pending Review record. */
function jobMatchesReview(job: KnowledgeIngestJob, record: PendingChangeSetReviewRecord): boolean {
  return (
    job.status === "awaiting_review" &&
    job.changeSetId === record.changeSetId &&
    job.id === record.jobClaim.jobId &&
    job.sourceId === record.jobClaim.sourceId &&
    job.sourceContentHash === record.jobClaim.sourceContentHash &&
    job.pipelineFingerprint === record.jobClaim.pipelineFingerprint &&
    job.inputRevision === record.jobClaim.inputRevision &&
    job.attempt === record.jobClaim.attempt
  );
}

/** Reports whether one Queue anchor exactly names a pending Review record. */
function anchorMatchesReview(
  snapshot: IngestQueueSnapshot,
  record: PendingChangeSetReviewRecord
): boolean {
  const anchor = snapshot.pendingReviews.find(
    (candidate) => candidate.kind === "durable" && candidate.changeSetId === record.changeSetId
  );
  const job = snapshot.jobs.find((candidate) => candidate.id === record.jobClaim.jobId);
  return (
    anchor?.kind === "durable" &&
    anchor.jobId === record.jobClaim.jobId &&
    anchor.proposalDigest === record.proposalDigest &&
    anchor.reviewRecordRevision === record.recordRevision &&
    anchor.recordedAt === record.recordedAt &&
    job !== undefined &&
    jobMatchesReview(job, record)
  );
}

/**
 * Selects only exact Queue-anchored pending records and rejects dangling anchors.
 *
 * A proposal saved just before Queue hand-off is intentionally hidden. The
 * opposite state is invalid because Queue claims user-review readiness without
 * the durable proposal it names.
 */
function selectPendingReviews(
  queue: IngestQueueSnapshot,
  review: ChangeSetReviewSnapshot
): PendingChangeSetReviewRecord[] {
  const pending = review.records.filter(
    (record): record is PendingChangeSetReviewRecord => record.outcome === "pending"
  );
  for (const anchor of queue.pendingReviews) {
    if (anchor.kind !== "durable") continue;
    const record = pending.find((candidate) => candidate.changeSetId === anchor.changeSetId);
    if (!record || !anchorMatchesReview(queue, record)) {
      throw new KnowledgeStudioRuntimeReadError();
    }
  }
  return pending
    .filter((record) => anchorMatchesReview(queue, record))
    .sort(
      (left, right) =>
        left.recordedAt - right.recordedAt || compareText(left.changeSetId, right.changeSetId)
    );
}

/** Reads one own enumerable data property without invoking an accessor. */
function readDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) throw new KnowledgeStudioRuntimeReadError();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new KnowledgeStudioRuntimeReadError();
  }
  return descriptor.value;
}

/** Requires an exact own string-key set on one resolver result item. */
function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const actual = Reflect.ownKeys(value);
    const sorted = [...expected].sort(compareText);
    return (
      actual.length === sorted.length &&
      actual.every((key) => typeof key === "string") &&
      actual.sort(compareText).every((key, index) => key === sorted[index])
    );
  } catch {
    return false;
  }
}

/** Validates that a resolver-returned path is the requested Windows target. */
function assertObservedPath(path: unknown, request: CompilerTargetRequest): void {
  const parsed = typeof path === "string" ? parseVaultPath(path) : undefined;
  if (
    !parsed?.ok ||
    parsed.path !== path ||
    toWindowsPathKey(parsed.path) !== toWindowsPathKey(request.path)
  ) {
    throw new KnowledgeStudioRuntimeReadError();
  }
}

/** Converts one strict compiler target observation into a Review observation. */
function toReviewObservation(
  value: unknown,
  request: CompilerTargetRequest,
  characterBudget: { used: number }
): KnowledgeReviewTargetObservation {
  const targetId = readDataProperty(value, "targetId");
  const kind = readDataProperty(value, "kind");
  if (targetId !== request.targetId) throw new KnowledgeStudioRuntimeReadError();

  if (kind === "missing" && hasExactKeys(value, ["targetId", "kind", "windowsPathKey"])) {
    if (readDataProperty(value, "windowsPathKey") !== toWindowsPathKey(request.path)) {
      throw new KnowledgeStudioRuntimeReadError();
    }
    return { changeId: request.targetId, kind: "missing" };
  }
  if (kind === "occupied" && hasExactKeys(value, ["targetId", "kind", "path"])) {
    assertObservedPath(readDataProperty(value, "path"), request);
    return { changeId: request.targetId, kind: "occupied" };
  }
  if (kind === "directory" && hasExactKeys(value, ["targetId", "kind", "path"])) {
    assertObservedPath(readDataProperty(value, "path"), request);
    return { changeId: request.targetId, kind: "directory" };
  }
  if (kind === "file" && hasExactKeys(value, ["targetId", "kind", "path", "content"])) {
    assertObservedPath(readDataProperty(value, "path"), request);
    const content = readDataProperty(value, "content");
    if (typeof content !== "string") throw new KnowledgeStudioRuntimeReadError();
    characterBudget.used += content.length;
    if (characterBudget.used > MAX_REVIEW_TARGET_CHARACTERS) {
      return { changeId: request.targetId, kind: "unavailable" };
    }
    return { changeId: request.targetId, kind: "file", content };
  }
  throw new KnowledgeStudioRuntimeReadError();
}

/** Strictly snapshots one complete resolver result in request order. */
function parseTargetObservations(
  value: unknown,
  requests: readonly CompilerTargetRequest[]
): KnowledgeReviewTargetObservation[] {
  if (!Array.isArray(value) || value.length !== requests.length) {
    throw new KnowledgeStudioRuntimeReadError();
  }
  const byId = new Map<string, unknown>();
  for (let index = 0; index < value.length; index += 1) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !("value" in item) || !item.enumerable) {
      throw new KnowledgeStudioRuntimeReadError();
    }
    const targetId = readDataProperty(item.value, "targetId");
    if (typeof targetId !== "string" || byId.has(targetId)) {
      throw new KnowledgeStudioRuntimeReadError();
    }
    byId.set(targetId, item.value);
  }
  const budget = { used: 0 };
  return requests.map((request) => {
    const observation = byId.get(request.targetId);
    if (!observation) throw new KnowledgeStudioRuntimeReadError();
    return toReviewObservation(observation, request, budget);
  });
}

/** Builds strict read requests from one Bundle-validated proposal. */
function createTargetRequests(record: PendingChangeSetReviewRecord): CompilerTargetRequest[] {
  return record.proposal.changes.map((change) => ({
    targetId: change.id,
    path: change.path,
    intent: change.operation === "delete" ? "delete" : "write",
    access: change.operation === "create" ? "create_only" : "authorized",
  }));
}

/** Reports whether an error is intentional cancellation. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Deep-freezes one internally constructed Review plan before UI publication. */
function freezeReviewPlan(plan: KnowledgeReviewPlan): KnowledgeReviewPlan {
  for (const file of plan.files) {
    for (const block of file.blocks) {
      for (const part of block.parts) Object.freeze(part);
      Object.freeze(block.parts);
      Object.freeze(block);
    }
    Object.freeze(file.sourceRefs);
    Object.freeze(file.blocks);
    Object.freeze(file);
  }
  Object.freeze(plan.sourceRefs);
  Object.freeze(plan.validation);
  Object.freeze(plan.files);
  return Object.freeze(plan);
}

/** Resolves current target state, mapping transient Vault unavailability safely. */
async function resolveReviewTargets(
  resolver: CompilerTargetResolver,
  requests: readonly CompilerTargetRequest[],
  signal: AbortSignal
): Promise<KnowledgeReviewTargetObservation[]> {
  try {
    const result = await resolver.resolve(requests, signal);
    throwIfAborted(signal);
    return parseTargetObservations(result, requests);
  } catch (error) {
    if (signal.aborted || isAbortError(error))
      throw new DOMException("The operation was aborted", "AbortError");
    const code = ObsidianKnowledgeCompilerTargetResolverError.inspect(error);
    if (code === "state_changed") throw new KnowledgeStudioConsistencyRetry();
    if (code === "vault_unavailable") {
      return requests.map((request) => ({ changeId: request.targetId, kind: "unavailable" }));
    }
    if (error instanceof KnowledgeStudioRuntimeReadError) throw error;
    throw new KnowledgeStudioRuntimeReadError();
  }
}

/** Builds all exact pending Review plans for one atomic Runtime projection. */
async function createReviewContexts(
  projection: KnowledgeRuntimeStudioBundleSnapshot,
  bundle: KnowledgeBundleConfig,
  resolver: CompilerTargetResolver,
  signal: AbortSignal,
  assertCurrent: () => void,
  changeSetId?: string
): Promise<KnowledgeStudioReviewContext[]> {
  const records = selectPendingReviews(projection.queue, projection.review).filter(
    (record) => changeSetId === undefined || record.changeSetId === changeSetId
  );
  const contexts: KnowledgeStudioReviewContext[] = [];
  for (const record of records) {
    throwIfAborted(signal);
    assertCurrent();
    if (!validateKnowledgeChangeSet(record.proposal, bundle).valid) {
      throw new KnowledgeStudioRuntimeReadError();
    }
    const requests = createTargetRequests(record);
    const observations = await resolveReviewTargets(resolver, requests, signal);
    throwIfAborted(signal);
    assertCurrent();
    contexts.push({
      record,
      observations: Object.freeze(observations.map((observation) => Object.freeze(observation))),
      plan: freezeReviewPlan(createKnowledgeReviewPlan(record.proposal, observations)),
    });
  }
  return contexts;
}

/**
 * Reconstructs one command-time Review context from a consistent Runtime/Vault read-set.
 *
 * The rendered plan is never reused as authority. Queue and Review are read from
 * one Runtime envelope, targets are observed afresh, and the outer Runtime
 * revision is re-read before the context is returned.
 */
export async function loadKnowledgeStudioReviewContext(
  input: KnowledgeStudioReviewContextLoadInput
): Promise<KnowledgeStudioReviewContext | undefined> {
  const maxAttempts = input.maxConsistencyAttempts ?? DEFAULT_MAX_CONSISTENCY_ATTEMPTS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new KnowledgeStudioRuntimeReadError();
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      throwIfAborted(input.signal);
      input.assertCurrent();
      const before = await input.runtime.readStudioBundle(input.bundle.id);
      throwIfAborted(input.signal);
      input.assertCurrent();
      const contexts = await createReviewContexts(
        before,
        input.bundle,
        input.targetResolver,
        input.signal,
        () => input.assertCurrent(),
        input.changeSetId
      );
      const after = await input.runtime.readStudioBundle(input.bundle.id);
      throwIfAborted(input.signal);
      input.assertCurrent();
      if (before.runtimeRevision !== after.runtimeRevision) {
        throw new KnowledgeStudioConsistencyRetry();
      }
      return contexts[0];
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      if (error instanceof KnowledgeStudioConsistencyRetry) continue;
      throw error instanceof KnowledgeStudioRuntimeReadError
        ? error
        : new KnowledgeStudioRuntimeReadError();
    }
  }
  throw new KnowledgeStudioRuntimeReadError();
}

/** Creates one opaque render revision containing no paths or file content. */
function createRevisionToken(
  projection: KnowledgeRuntimeStudioBundleSnapshot,
  plans: readonly KnowledgeReviewPlan[]
): string {
  const digest = sha256(
    `knowledge-studio-read-v1\n${canonicalizeJson({
      runtimeRevision: projection.runtimeRevision,
      queueRevision: projection.queue.revision,
      reviewRevision: projection.review.revision,
      reviewSnapshotTokens: plans.map((plan) => plan.snapshotToken),
    })}`
  );
  return `r${projection.runtimeRevision}-q${projection.queue.revision}-v${projection.review.revision}-${digest.slice(0, 12)}`;
}

/**
 * Production adapter for durable Studio reads, scoped Query, and narrow commands.
 *
 * Queue and Review come from one Runtime envelope. Target observations are
 * followed by an outer-revision reproof; concurrent mutation causes a bounded
 * full retry instead of publishing a mixed snapshot. Commands remain fail-closed
 * unless an authentic same-generation command adapter was installed explicitly.
 */
export class KnowledgeStudioRuntimeReadAdapter
  implements
    KnowledgeStudioReadPort,
    KnowledgeStudioCommandPort,
    KnowledgeStudioQueryWritebackPort,
    KnowledgeStudioReviewEvidencePort,
    KnowledgeSourceLifecyclePort
{
  private readonly input: KnowledgeStudioRuntimeReadAdapterInput;
  private readonly bundles: ReadonlyMap<string, KnowledgeBundleConfig>;
  private readonly maxConsistencyAttempts: number;

  /** Captures one exact Runtime, Bundle, resolver, and lifecycle generation. */
  constructor(input: KnowledgeStudioRuntimeReadAdapterInput) {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.runtime?.readStudioBundle !== "function" ||
      typeof input.runtime?.subscribeStudioBundle !== "function" ||
      typeof input.targetResolver?.resolve !== "function" ||
      typeof input.assertCurrent !== "function"
    ) {
      throw new KnowledgeStudioRuntimeReadError();
    }
    this.bundles = snapshotBundles(input.bundles);
    if (input.commands !== undefined) {
      KnowledgeStudioRuntimeCommandAdapter.assert(input.commands);
    }
    const query = captureOptionalQueryPort(input);
    const reviewEvidence =
      input.reviewEvidence === undefined
        ? undefined
        : captureReviewEvidencePort(input.reviewEvidence);
    const sourceLifecycle =
      input.sourceLifecycle === undefined
        ? undefined
        : captureSourceLifecyclePort(input.sourceLifecycle);
    const assertCurrent = input.assertCurrent.bind(input);
    this.input = Object.freeze({
      runtime: input.runtime,
      bundles: Object.freeze([...input.bundles]),
      targetResolver: input.targetResolver,
      assertCurrent,
      ...(input.commands === undefined ? {} : { commands: input.commands }),
      ...(query === undefined ? {} : { query }),
      ...(reviewEvidence === undefined ? {} : { reviewEvidence }),
      ...(sourceLifecycle === undefined ? {} : { sourceLifecycle }),
      ...(input.subscribeVaultHints === undefined
        ? {}
        : { subscribeVaultHints: input.subscribeVaultHints }),
      ...(input.maxConsistencyAttempts === undefined
        ? {}
        : { maxConsistencyAttempts: input.maxConsistencyAttempts }),
    });
    this.maxConsistencyAttempts = input.maxConsistencyAttempts ?? DEFAULT_MAX_CONSISTENCY_ATTEMPTS;
    if (!Number.isSafeInteger(this.maxConsistencyAttempts) || this.maxConsistencyAttempts < 1) {
      throw new KnowledgeStudioRuntimeReadError();
    }
  }

  /** Loads one consistent live Activity/Review snapshot without mutation authority. */
  async load(bundleId: string, signal: AbortSignal): Promise<KnowledgeStudioSnapshot> {
    const bundle = this.bundles.get(bundleId);
    if (!bundle) throw new KnowledgeStudioRuntimeReadError();
    for (let attempt = 0; attempt < this.maxConsistencyAttempts; attempt += 1) {
      try {
        throwIfAborted(signal);
        this.input.assertCurrent();
        const before = await this.input.runtime.readStudioBundle(bundleId);
        throwIfAborted(signal);
        this.input.assertCurrent();
        const reviewContexts = await createReviewContexts(
          before,
          bundle,
          this.input.targetResolver,
          signal,
          () => this.input.assertCurrent()
        );
        const sourceLifecycle = this.input.sourceLifecycle
          ? await this.input.sourceLifecycle.loadSources(bundleId, signal)
          : undefined;
        const after = await this.input.runtime.readStudioBundle(bundleId);
        throwIfAborted(signal);
        this.input.assertCurrent();
        if (
          before.runtimeRevision !== after.runtimeRevision ||
          (sourceLifecycle !== undefined &&
            (sourceLifecycle.bundleId !== bundleId ||
              sourceLifecycle.runtimeRevision !== before.runtimeRevision))
        ) {
          throw new KnowledgeStudioConsistencyRetry();
        }
        const reviews = reviewContexts.map(({ plan }) => plan);
        return Object.freeze({
          bundleId,
          revisionToken: createRevisionToken(before, reviews),
          availability: "ready" as const,
          commandCapabilities: this.input.commands
            ? this.input.commands.getCapabilities()
            : NO_KNOWLEDGE_STUDIO_COMMAND_CAPABILITIES,
          activity: deriveKnowledgeActivityModel(before.queue),
          reviews: Object.freeze(reviews),
          recovery: Object.freeze({
            bundleId,
            runtimeRevision: before.runtimeRevision,
            items: Object.freeze([]),
          }),
          ...(sourceLifecycle === undefined ? {} : { sourceLifecycle }),
          queryAvailable: this.input.query !== undefined,
          queryWritebackAvailable: this.input.query?.supportsWriteback?.() === true,
          reviewEvidenceAvailable: this.input.reviewEvidence !== undefined,
          notice: this.input.commands
            ? this.input.commands.getCapabilities().reviewAccept
              ? this.input.query
                ? this.input.query.supportsWriteback?.() === true
                  ? this.input.sourceLifecycle
                    ? "Durable Activity, Review, Apply, grounded Query, reviewed Save to Wiki, exact Query and Review evidence navigation, and source lifecycle recovery are connected. Saved answers enter Review before any Wiki change. Sources can be safely retired without deleting generated Wiki files; generated Wiki deletion remains disabled."
                    : "Durable Activity, Review, Apply, grounded Query, reviewed Save to Wiki, and exact Query and Review evidence navigation are connected. Saved answers enter Review before any Wiki change; generated Wiki deletion remains disabled."
                  : "Durable Activity, Review, Apply, and grounded Query are connected. Query may call the selected DeepSeek model using only freshly verified source excerpts. Save to Wiki and delete remain disabled."
                : this.input.reviewEvidence
                  ? "Durable Activity, Review, Apply, and exact Review evidence navigation are connected. Eligible create and update selections can be explicitly applied; delete acceptance and Query remain disabled."
                  : "Durable Activity and Review are connected. Eligible create and update selections can be explicitly applied; delete acceptance and Query remain disabled."
              : "Durable Activity commands and proposal rejection are connected. Acceptance and Wiki apply remain disabled."
            : this.input.query
              ? "Live durable Activity, Review, and grounded Query are connected. Query may call the selected DeepSeek model using only freshly verified source excerpts. Save to Wiki, PDF jump, Review decisions, and Wiki apply remain disabled."
              : "Live durable Activity and Review are connected. Review decisions and Wiki apply remain disabled until their safe adapters are connected.",
        });
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        if (error instanceof KnowledgeStudioConsistencyRetry) continue;
        throw error instanceof KnowledgeStudioRuntimeReadError
          ? error
          : new KnowledgeStudioRuntimeReadError();
      }
    }
    throw new KnowledgeStudioRuntimeReadError();
  }

  /** Subscribes to Runtime plus coalesced Vault/source-issue hints for one Bundle. */
  subscribe(bundleId: string, onHint: () => void): () => void {
    if (!this.bundles.has(bundleId) || typeof onHint !== "function") {
      throw new KnowledgeStudioRuntimeReadError();
    }
    const unsubscribers: Array<() => void> = [];
    let active = true;
    const handleHint = (): void => {
      if (!active) return;
      try {
        this.input.query?.revokeCurrent(bundleId);
      } catch {
        // A stale generation is already fail-closed; the durable reload still runs.
      }
      if (active) onHint();
    };
    try {
      this.input.assertCurrent();
      const unsubscribeRuntime = this.input.runtime.subscribeStudioBundle(bundleId, handleHint);
      if (typeof unsubscribeRuntime !== "function") throw new KnowledgeStudioRuntimeReadError();
      unsubscribers.push(unsubscribeRuntime);
      if (this.input.subscribeVaultHints) {
        const unsubscribeVault = this.input.subscribeVaultHints(bundleId, handleHint);
        if (typeof unsubscribeVault !== "function") throw new KnowledgeStudioRuntimeReadError();
        unsubscribers.push(unsubscribeVault);
      }
      if (this.input.commands) {
        const unsubscribeCommands = this.input.commands.subscribe(bundleId, handleHint);
        if (typeof unsubscribeCommands !== "function") {
          throw new KnowledgeStudioRuntimeReadError();
        }
        unsubscribers.push(unsubscribeCommands);
      }
    } catch (error) {
      active = false;
      for (const unsubscribe of unsubscribers) {
        try {
          unsubscribe();
        } catch {
          // The subscription never became authoritative.
        }
      }
      if (isAbortError(error)) throw new DOMException("The operation was aborted", "AbortError");
      throw new KnowledgeStudioRuntimeReadError();
    }
    return () => {
      if (!active) return;
      active = false;
      for (const unsubscribe of unsubscribers) {
        try {
          unsubscribe();
        } catch {
          // Reload hints are already detached from this adapter generation.
        }
      }
    };
  }

  /** Delegates pause only when the durable Activity command adapter is installed. */
  async pauseBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    if (!this.input.commands) throw new KnowledgeStudioAdapterUnavailableError();
    return this.input.commands.pauseBundle(bundleId, expectedQueueRevision, signal);
  }

  /** Delegates resume only when the durable Activity command adapter is installed. */
  async resumeBundle(
    bundleId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    if (!this.input.commands) throw new KnowledgeStudioAdapterUnavailableError();
    return this.input.commands.resumeBundle(bundleId, expectedQueueRevision, signal);
  }

  /** Delegates cancellation only when the durable Activity command adapter is installed. */
  async cancelJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    if (!this.input.commands) throw new KnowledgeStudioAdapterUnavailableError();
    return this.input.commands.cancelJob(bundleId, jobId, expectedQueueRevision, signal);
  }

  /** Delegates retry only when the durable Activity command adapter is installed. */
  async retryJob(
    bundleId: string,
    jobId: string,
    expectedQueueRevision: number,
    signal: AbortSignal
  ): Promise<void> {
    if (!this.input.commands) throw new KnowledgeStudioAdapterUnavailableError();
    return this.input.commands.retryJob(bundleId, jobId, expectedQueueRevision, signal);
  }

  /** Delegates Review submission only when narrow command orchestration is installed. */
  async submitReview(
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    if (!this.input.commands) throw new KnowledgeStudioAdapterUnavailableError();
    return this.input.commands.submitReview(bundleId, command, signal);
  }

  /** Opens one opaque current Review evidence reference through the production coordinator. */
  async openReviewEvidence(
    bundleId: string,
    request: Parameters<KnowledgeStudioReviewEvidencePort["openReviewEvidence"]>[1],
    signal: AbortSignal
  ): ReturnType<KnowledgeStudioReviewEvidencePort["openReviewEvidence"]> {
    if (!this.input.reviewEvidence) throw new KnowledgeStudioAdapterUnavailableError();
    return this.input.reviewEvidence.openReviewEvidence(bundleId, request, signal);
  }

  /** Rejects recovery continuation because live workflow snapshots contain no recovery rows. */
  async continueRecovery(
    _bundleId: string,
    _recoveryId: string,
    _expectedRuntimeRevision: number,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  /** Rejects recovery abandonment because live workflow snapshots contain no recovery rows. */
  async abandonRecovery(
    _bundleId: string,
    _recoveryId: string,
    _expectedRuntimeRevision: number,
    _signal: AbortSignal
  ): Promise<KnowledgeStudioRecoverySubmissionResult> {
    throw new KnowledgeStudioAdapterUnavailableError();
  }

  /** Loads the source lifecycle projection through this exact production generation. */
  async loadSources(bundleId: string, signal: AbortSignal) {
    if (!this.input.sourceLifecycle) throw new KnowledgeStudioAdapterUnavailableError();
    return this.input.sourceLifecycle.loadSources(bundleId, signal);
  }

  /** Requests a full source recheck through this exact production generation. */
  async checkAgain(bundleId: string, sourceId: string, signal: AbortSignal): Promise<void> {
    if (!this.input.sourceLifecycle) throw new KnowledgeStudioAdapterUnavailableError();
    return this.input.sourceLifecycle.checkAgain(bundleId, sourceId, signal);
  }

  /** Atomically retires one exact source while retaining current Wiki bytes. */
  async retireSource(
    bundleId: string,
    request: Readonly<KnowledgeSourceRetirementRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceRetirementUiReceipt>> {
    if (!this.input.sourceLifecycle) throw new KnowledgeStudioAdapterUnavailableError();
    return this.input.sourceLifecycle.retireSource(bundleId, request, signal);
  }

  /** Runs one scoped retrieval-only query when the live generation installed it. */
  async query(
    bundleId: string,
    request: Readonly<KnowledgeStudioQueryRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryResult> {
    if (!this.input.query) throw new KnowledgeStudioAdapterUnavailableError();
    return this.input.query.query(bundleId, request, signal);
  }

  /** Opens one coordinator-issued source citation through the live generation. */
  async openCitation(
    bundleId: string,
    queryId: string,
    citationRef: string,
    signal: AbortSignal
  ): Promise<void> {
    if (!this.input.query) throw new KnowledgeStudioAdapterUnavailableError();
    return this.input.query.openCitation(bundleId, queryId, citationRef, signal);
  }

  /** Registers one current grounded answer through the captured generation. */
  async saveQueryToWiki(
    bundleId: string,
    queryId: string,
    request: Readonly<KnowledgeStudioQueryWritebackRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryWritebackResult> {
    if (!this.input.query?.supportsWriteback?.() || !this.input.query.saveQueryToWiki) {
      throw new KnowledgeStudioAdapterUnavailableError();
    }
    return this.input.query.saveQueryToWiki(bundleId, queryId, request, signal);
  }

  /** Revokes the current scoped Query and opaque citation references. */
  revokeCurrent(bundleId: string, queryId?: string): void {
    if (!this.input.query) throw new KnowledgeStudioAdapterUnavailableError();
    this.input.query.revokeCurrent(bundleId, queryId);
  }
}
