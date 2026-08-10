import { App, EventRef, TAbstractFile, TFile, Vault } from "obsidian";

import type {
  AllocateSourceInputRevisionRequest,
  BindSourceInputObservationRequest,
  SourceInputRevisionAllocation,
} from "@/knowledge/ingest/InputRevisionAllocator";
import {
  KnowledgeSourceWatchPlan,
  type WatchedKnowledgeGeneratedOutput,
  type WatchedKnowledgeSource,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { CommitSourceInputObservationResult } from "@/knowledge/ingest/SourceObservationHandoff";
import { createSourceContentHash, isExactUint8Array } from "@/knowledge/model/fingerprint";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_STAGE_ATTEMPTS = 2;
// Capturing this intrinsic accessor is intentional; Reflect.apply supplies the candidate receiver.
// eslint-disable-next-line @typescript-eslint/unbound-method
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength"
)?.get;

/** Narrow durable hand-off capability available to the Vault watcher. */
export interface VaultSourceObservationHandoffPort {
  /** Allocates a durable revision before any asynchronous source read. */
  allocate(request: AllocateSourceInputRevisionRequest): Promise<SourceInputRevisionAllocation>;
  /** Binds exact bytes and submits only through the durable Queue hand-off. */
  commit(request: BindSourceInputObservationRequest): Promise<CommitSourceInputObservationResult>;
}

/** Exact source bytes and their raw SHA-256 observation. */
export interface ExactSourceArtifact {
  sourcePath: string;
  bytes: Uint8Array;
  sourceContentHash: string;
}

/** Supported Vault causes that may produce a source observation. */
export type VaultSourceCaptureCause =
  | "initial_scan"
  | "create"
  | "modify"
  | "generated_output_create"
  | "generated_output_modify"
  | "generated_output_delete"
  | "generated_output_rename";

/** Capture pipeline stage used by sanitized watcher failures. */
export type VaultSourceCaptureStage = "prepare" | "allocate" | "read" | "commit";

/** Best-effort watcher notification that never owns durable state. */
export type VaultSourceWatcherNotification =
  | {
      kind: "capture_settled";
      cause: VaultSourceCaptureCause;
      bundleId: string;
      sourceId: string;
      captureId: string;
      inputRevision: number;
      settlement: CommitSourceInputObservationResult["kind"];
    }
  | {
      kind: "capture_failed";
      cause: VaultSourceCaptureCause;
      bundleId: string;
      sourceId: string;
      captureId: string;
      stage: VaultSourceCaptureStage;
    }
  | {
      kind: "source_missing";
      bundleId: string;
      sourceId: string;
    }
  | {
      kind: "source_path_invalid";
      reason: "case_mismatch" | "windows_collision";
      bundleId: string;
      sourceId: string;
    }
  | {
      kind: "source_change_unsupported";
      change: "delete" | "rename";
      bundleId: string;
      sourceId: string;
    };

/** Authoritative, sanitized reason that one watcher generation cannot become ready. */
export type VaultSourceWatcherStartupBlocker =
  | {
      kind: "capture_failed";
      stage: VaultSourceCaptureStage;
      bundleId: string;
      sourceId: string;
    }
  | {
      kind: "source_missing";
      bundleId: string;
      sourceId: string;
    }
  | {
      kind: "source_path_invalid";
      reason: "case_mismatch" | "windows_collision";
      bundleId: string;
      sourceId: string;
    }
  | {
      kind: "source_change_unsupported";
      change: "delete" | "rename";
      bundleId: string;
      sourceId: string;
    };

/** Non-authoritative sink used by future Activity and diagnostic adapters. */
export interface VaultSourceWatcherNotificationSink {
  /** Receives one sanitized post-observation hint. */
  emit(notification: VaultSourceWatcherNotification): void;
}

/** Retry and deterministic test seams for one watcher lifecycle. */
export interface ObsidianVaultSourceWatcherOptions {
  captureIdFactory?: () => string;
  artifactReader?: ObsidianExactSourceArtifactReader;
  notificationSink?: VaultSourceWatcherNotificationSink;
  maxAllocateAttempts?: number;
  maxReadAttempts?: number;
  maxCommitAttempts?: number;
}

/** Reports a missing Bundle handoff or a reader owned by another App/Vault. */
export class VaultSourceWatchPlanError extends TypeError {
  /** Creates a sanitized watcher-dependency error. */
  constructor() {
    super("The knowledge source watcher dependencies are invalid");
    this.name = "VaultSourceWatchPlanError";
  }
}

/** Reports use of a watcher after its exact App/Vault lifecycle closed. */
export class VaultSourceWatcherClosedError extends Error {
  /** Creates a stable closed-lifecycle error. */
  constructor() {
    super("The knowledge source watcher lifecycle is closed");
    this.name = "VaultSourceWatcherClosedError";
  }
}

/** Reports a missing or non-file source path at the binary adapter edge. */
export class SourceArtifactUnavailableError extends Error {
  /** Creates a sanitized unavailable-artifact error. */
  constructor() {
    super("The source artifact is unavailable");
    this.name = "SourceArtifactUnavailableError";
  }
}

/** Reports a malformed success payload returned by the Vault data adapter. */
export class SourceArtifactAdapterPayloadError extends Error {
  /** Creates a sanitized adapter-payload error. */
  constructor() {
    super("The source artifact adapter returned an invalid payload");
    this.name = "SourceArtifactAdapterPayloadError";
  }
}

/** Reports source bytes that no longer match the durable Queue job identity. */
export class SourceArtifactHashMismatchError extends Error {
  /** Creates a sanitized content-address mismatch error. */
  constructor() {
    super("The source artifact no longer matches the expected content hash");
    this.name = "SourceArtifactHashMismatchError";
  }
}

/** Reports a success payload that violates an injected durable-port contract. */
export class VaultSourceObservationContractError extends Error {
  /** Creates a sanitized fail-closed observation-contract error. */
  constructor() {
    super("A knowledge source observation port returned an invalid success payload");
    this.name = "VaultSourceObservationContractError";
  }
}

type ImmutableWatchedKnowledgeSource = Readonly<WatchedKnowledgeSource>;
type ImmutableWatchedKnowledgeGeneratedOutput = Readonly<WatchedKnowledgeGeneratedOutput>;

interface CaptureAuthority {
  lifecycleGeneration: number;
  watchPlanGeneration: number;
  sourceAuthorityKey: string;
  sourceGeneration: number;
}

interface SourceCaptureWork extends CaptureAuthority {
  source: ImmutableWatchedKnowledgeSource;
  capturedPath: string;
  captureId: string;
  cause: VaultSourceCaptureCause;
  handoff: VaultSourceObservationHandoffPort;
}

interface GeneratedOutputEventMatch {
  output: ImmutableWatchedKnowledgeGeneratedOutput;
  owners: readonly ImmutableWatchedKnowledgeSource[];
  caseMismatch: boolean;
}

/**
 * Creates an AbortError without depending on a particular renderer Window.
 *
 * @returns Stable platform-style cancellation error
 */
function createAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Stops one exact-byte read before or after an uninterruptible adapter call.
 *
 * @param signal - Optional caller-owned cancellation signal
 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

/**
 * Validates one positive safe retry bound.
 *
 * @param value - Configured stage attempt count
 * @returns The validated attempt count
 */
function requireAttemptCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Watcher stage attempts must be positive safe integers");
  }
  return value;
}

/**
 * Tests whether an unknown adapter payload is an ArrayBuffer in any realm.
 *
 * @param value - Unknown adapter result
 * @returns Whether the value has the ArrayBuffer internal slot
 */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  if (typeof value !== "object" || value === null || !ARRAY_BUFFER_BYTE_LENGTH_GETTER) {
    return false;
  }
  try {
    Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value, []);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a capture identity returned by an injected factory.
 *
 * @param value - Unknown-at-runtime capture identity
 */
function assertCaptureIdentifier(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VaultSourceObservationContractError();
  }
}

/**
 * Produces the stable key for one Bundle/source pair.
 *
 * @param source - Registered source identity
 * @returns Collision key independent of source path
 */
function createBundleSourceKey(
  source: Pick<WatchedKnowledgeSource, "bundleId" | "sourceId">
): string {
  return `${source.bundleId.length}:${source.bundleId}${source.sourceId}`;
}

/** Compares stable identifiers without depending on the host locale. */
function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Reads required own data properties without invoking injected accessors.
 *
 * @param value - Unknown success payload
 * @param keys - Required own data-property names
 * @returns Detached one-read field snapshot, or undefined for malformed input
 */
function snapshotRequiredDataProperties(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null) {
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

/**
 * Resolves one callable data method once without invoking accessors.
 *
 * @param value - Unknown hand-off capability
 * @param key - Required method name
 * @returns Captured function and receiver, or undefined when malformed
 */
function snapshotDataMethod(
  value: unknown,
  key: "allocate" | "commit"
): { receiver: object; method: (...args: never[]) => unknown } | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return undefined;
  }
  const receiver = value;
  let owner: object | null = receiver;
  const visited = new Set<object>();
  while (owner) {
    if (owner === Object.prototype || visited.has(owner)) {
      return undefined;
    }
    visited.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        return undefined;
      }
      return { receiver, method: descriptor.value as (...args: never[]) => unknown };
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return undefined;
}

/**
 * Captures validated per-Bundle hand-off methods at watcher installation time.
 *
 * @param handoffs - Untrusted-at-runtime Bundle capability map
 * @returns Detached map whose functions cannot be swapped after installation
 */
function snapshotHandoffPorts(
  handoffs: ReadonlyMap<string, VaultSourceObservationHandoffPort>
): ReadonlyMap<string, VaultSourceObservationHandoffPort> {
  try {
    const snapshot = new Map<string, VaultSourceObservationHandoffPort>();
    for (const [bundleId, handoff] of handoffs) {
      if (typeof bundleId !== "string" || bundleId.length === 0 || snapshot.has(bundleId)) {
        throw new VaultSourceWatchPlanError();
      }
      const allocate = snapshotDataMethod(handoff, "allocate");
      const commit = snapshotDataMethod(handoff, "commit");
      if (!allocate || !commit) {
        throw new VaultSourceWatchPlanError();
      }
      snapshot.set(
        bundleId,
        Object.freeze({
          allocate: (request: AllocateSourceInputRevisionRequest) =>
            Reflect.apply(allocate.method, allocate.receiver, [
              request,
            ]) as Promise<SourceInputRevisionAllocation>,
          commit: (request: BindSourceInputObservationRequest) =>
            Reflect.apply(commit.method, commit.receiver, [
              request,
            ]) as Promise<CommitSourceInputObservationResult>,
        })
      );
    }
    return snapshot;
  } catch (error) {
    if (error instanceof VaultSourceWatchPlanError) {
      throw error;
    }
    throw new VaultSourceWatchPlanError();
  }
}

/**
 * Revalidates an exact-byte reader success before trusting its claimed hash.
 *
 * @param artifact - Unknown-at-runtime reader success
 * @param capturedPath - Exact path captured synchronously from the Vault event
 * @returns Detached, locally hashed source artifact
 */
function verifySourceArtifact(
  artifact: ExactSourceArtifact,
  capturedPath: string
): ExactSourceArtifact {
  const snapshot = snapshotRequiredDataProperties(artifact, [
    "sourcePath",
    "bytes",
    "sourceContentHash",
  ]);
  if (
    !snapshot ||
    snapshot.sourcePath !== capturedPath ||
    !isExactUint8Array(snapshot.bytes) ||
    typeof snapshot.sourceContentHash !== "string"
  ) {
    throw new VaultSourceObservationContractError();
  }
  const bytes = new Uint8Array(snapshot.bytes);
  const sourceContentHash = createSourceContentHash(bytes);
  if (
    !SHA256_PATTERN.test(snapshot.sourceContentHash) ||
    snapshot.sourceContentHash !== sourceContentHash
  ) {
    throw new VaultSourceObservationContractError();
  }
  return Object.freeze({ sourcePath: capturedPath, bytes, sourceContentHash });
}

/**
 * Revalidates a durable allocation against the exact capture request.
 *
 * @param allocation - Unknown-at-runtime allocator success
 * @param work - Immutable source capture identity
 * @returns Validated allocation capability
 */
function verifyAllocation(
  allocation: SourceInputRevisionAllocation,
  work: SourceCaptureWork
): SourceInputRevisionAllocation {
  const snapshot = snapshotRequiredDataProperties(allocation, [
    "bundleId",
    "sourceId",
    "captureId",
    "inputRevision",
    "observationToken",
  ]);
  if (
    !snapshot ||
    snapshot.bundleId !== work.source.bundleId ||
    snapshot.sourceId !== work.source.sourceId ||
    snapshot.captureId !== work.captureId ||
    !Number.isSafeInteger(snapshot.inputRevision) ||
    (snapshot.inputRevision as number) < 1 ||
    typeof snapshot.observationToken !== "string" ||
    snapshot.observationToken.trim().length === 0
  ) {
    throw new VaultSourceObservationContractError();
  }
  return Object.freeze({
    bundleId: snapshot.bundleId,
    sourceId: snapshot.sourceId,
    captureId: snapshot.captureId,
    inputRevision: snapshot.inputRevision as number,
    observationToken: snapshot.observationToken,
  });
}

/**
 * Revalidates a durable hand-off settlement against the exact bound payload.
 *
 * @param settlement - Unknown-at-runtime hand-off success
 * @param work - Immutable source capture identity
 * @param allocation - Exact allocation capability used by the hand-off
 * @param sourceContentHash - Locally verified raw-byte hash
 * @returns Validated durable settlement
 */
function verifySettlement(
  settlement: CommitSourceInputObservationResult,
  work: SourceCaptureWork,
  allocation: SourceInputRevisionAllocation,
  sourceContentHash: string
): CommitSourceInputObservationResult {
  const kindSnapshot = snapshotRequiredDataProperties(settlement, ["kind"]);
  if (!kindSnapshot || typeof kindSnapshot.kind !== "string") {
    throw new VaultSourceObservationContractError();
  }
  if (kindSnapshot.kind === "committed") {
    const committed = snapshotRequiredDataProperties(settlement, ["observation", "queueRevision"]);
    const observation = committed
      ? snapshotRequiredDataProperties(committed.observation, [
          "bundleId",
          "sourceId",
          "captureId",
          "inputRevision",
          "observationToken",
          "sourceContentHash",
          "pipelineFingerprint",
        ])
      : undefined;
    if (
      !committed ||
      !observation ||
      observation.bundleId !== work.source.bundleId ||
      observation.sourceId !== work.source.sourceId ||
      observation.captureId !== work.captureId ||
      observation.inputRevision !== allocation.inputRevision ||
      observation.observationToken !== allocation.observationToken ||
      observation.sourceContentHash !== sourceContentHash ||
      observation.pipelineFingerprint !== work.source.pipelineFingerprint ||
      !Number.isSafeInteger(committed.queueRevision) ||
      (committed.queueRevision as number) < 1
    ) {
      throw new VaultSourceObservationContractError();
    }
    return Object.freeze({
      kind: "committed",
      observation: Object.freeze({
        bundleId: observation.bundleId,
        sourceId: observation.sourceId,
        captureId: observation.captureId,
        inputRevision: observation.inputRevision,
        observationToken: observation.observationToken,
        sourceContentHash: observation.sourceContentHash,
        pipelineFingerprint: observation.pipelineFingerprint,
      }),
      queueRevision: committed.queueRevision as number,
    });
  }
  const superseded = snapshotRequiredDataProperties(settlement, [
    "bundleId",
    "sourceId",
    "captureId",
    "inputRevision",
    "supersededByInputRevision",
  ]);
  if (
    kindSnapshot.kind !== "superseded" ||
    !superseded ||
    superseded.bundleId !== work.source.bundleId ||
    superseded.sourceId !== work.source.sourceId ||
    superseded.captureId !== work.captureId ||
    superseded.inputRevision !== allocation.inputRevision ||
    !Number.isSafeInteger(superseded.supersededByInputRevision) ||
    (superseded.supersededByInputRevision as number) <= allocation.inputRevision
  ) {
    throw new VaultSourceObservationContractError();
  }
  return Object.freeze({
    kind: "superseded",
    bundleId: superseded.bundleId,
    sourceId: superseded.sourceId,
    captureId: superseded.captureId,
    inputRevision: superseded.inputRevision,
    supersededByInputRevision: superseded.supersededByInputRevision as number,
  });
}

/**
 * Exact-byte reader shared by watcher capture and the future executor adapter.
 *
 * It binds permanently to the App's current Vault adapter. Compiler execution
 * should call {@link readExpected} and pass the returned bytes directly to the
 * parser, avoiding a second path read or an unproven cache hit.
 */
export class ObsidianExactSourceArtifactReader {
  private readonly app: App;
  private readonly vault: Vault;
  private readonly adapter: Vault["adapter"];

  /** Captures one exact App/Vault owner for all future reads. */
  constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.adapter = app.vault.adapter;
  }

  /** Returns whether this reader belongs to the supplied exact App/Vault/adapter. */
  owns(app: App): boolean {
    return this.app === app && this.vault === app.vault && this.adapter === app.vault.adapter;
  }

  /**
   * Reads exact binary bytes and computes their unnormalized SHA-256 identity.
   *
   * @param sourcePath - Canonical Vault-relative path captured synchronously
   * @param signal - Optional lifecycle cancellation signal
   * @returns Detached bytes and their exact source hash
   */
  async read(sourcePath: string, signal?: AbortSignal): Promise<ExactSourceArtifact> {
    const parsed = parseVaultPath(sourcePath);
    if (!parsed.ok) {
      throw new SourceArtifactUnavailableError();
    }
    throwIfAborted(signal);
    const loaded = this.vault.getAbstractFileByPath(parsed.path);
    if (!(loaded instanceof TFile)) {
      throw new SourceArtifactUnavailableError();
    }

    const payload: unknown = await this.adapter.readBinary(parsed.path);
    throwIfAborted(signal);
    if (!isArrayBuffer(payload)) {
      throw new SourceArtifactAdapterPayloadError();
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(new Uint8Array(payload));
    } catch {
      throw new SourceArtifactAdapterPayloadError();
    }
    return {
      sourcePath: parsed.path,
      bytes,
      sourceContentHash: createSourceContentHash(bytes),
    };
  }

  /**
   * Re-reads one job source and rejects stale bytes before parser/model work.
   *
   * @param sourcePath - Current Manifest path for the durable source id
   * @param expectedContentHash - Exact raw-byte hash carried by the Queue job
   * @param signal - Optional executor cancellation signal
   * @returns The same verified bytes that the parser must consume
   */
  async readExpected(
    sourcePath: string,
    expectedContentHash: string,
    signal?: AbortSignal
  ): Promise<ExactSourceArtifact> {
    if (!SHA256_PATTERN.test(expectedContentHash)) {
      throw new TypeError("Expected a lowercase SHA-256 source hash");
    }
    const artifact = await this.read(sourcePath, signal);
    if (artifact.sourceContentHash !== expectedContentHash) {
      throw new SourceArtifactHashMismatchError();
    }
    return artifact;
  }
}

/**
 * Watches an immutable set of already-registered Vault sources.
 *
 * This adapter deliberately does not discover source identities, mutate a
 * Manifest, write Wiki pages, run startup recovery, or claim Queue work. In
 * addition to source events, committed Manifest outputs are read-only drift
 * signals: their events can only re-observe their original source owners.
 * Rename and delete remain fail-closed for source-lifecycle changes.
 */
export class ObsidianVaultSourceWatcher {
  private readonly app: App;
  private readonly vault: Vault;
  private readonly handoffs: ReadonlyMap<string, VaultSourceObservationHandoffPort>;
  private readonly captureIdFactory: () => string;
  private readonly artifactReader: ObsidianExactSourceArtifactReader;
  private readonly notificationSink?: VaultSourceWatcherNotificationSink;
  private readonly maxAllocateAttempts: number;
  private readonly maxReadAttempts: number;
  private readonly maxCommitAttempts: number;
  private watchPlan: KnowledgeSourceWatchPlan;
  private lifecycleGeneration = 0;
  private watchPlanGeneration = 1;
  private started = false;
  private crawlActivated = false;
  private closed = false;
  private readonly eventRefs: EventRef[] = [];
  private readonly pendingCaptures = new Set<Promise<void>>();
  private readonly quarantinedSourceKeys = new Set<string>();
  private readonly startupBlockers = new Map<string, Readonly<VaultSourceWatcherStartupBlocker>>();
  private readonly sourceGenerations = new Map<string, number>();
  private readonly usedCaptureIds = new Set<string>();

  /**
   * Creates one exact App/Vault watcher over an immutable registered-source plan.
   *
   * @param app - Exact plugin lifecycle owner
   * @param plan - Opaque plan built from validated Bundle and Manifest authority
   * @param handoffs - Per-Bundle durable hand-off capabilities
   * @param options - Retry, reader, id, and notification seams
   */
  constructor(
    app: App,
    plan: KnowledgeSourceWatchPlan,
    handoffs: ReadonlyMap<string, VaultSourceObservationHandoffPort>,
    options: ObsidianVaultSourceWatcherOptions = {}
  ) {
    KnowledgeSourceWatchPlan.assert(plan);
    this.app = app;
    this.vault = app.vault;
    this.watchPlan = plan;
    this.handoffs = snapshotHandoffPorts(handoffs);
    for (const authority of this.watchPlan.getBundleAuthorities()) {
      if (!this.handoffs.get(authority.bundleId)) {
        throw new VaultSourceWatchPlanError();
      }
    }
    this.captureIdFactory =
      options.captureIdFactory ?? (() => `knowledge-capture-${crypto.randomUUID()}`);
    this.artifactReader = options.artifactReader ?? new ObsidianExactSourceArtifactReader(app);
    if (!this.artifactReader.owns(app)) {
      throw new VaultSourceWatchPlanError();
    }
    this.notificationSink = options.notificationSink;
    this.maxAllocateAttempts = requireAttemptCount(
      options.maxAllocateAttempts ?? DEFAULT_STAGE_ATTEMPTS
    );
    this.maxReadAttempts = requireAttemptCount(options.maxReadAttempts ?? DEFAULT_STAGE_ATTEMPTS);
    this.maxCommitAttempts = requireAttemptCount(
      options.maxCommitAttempts ?? DEFAULT_STAGE_ATTEMPTS
    );
  }

  /** Returns whether this watcher still belongs to the supplied exact App. */
  owns(app: App): boolean {
    return (
      !this.closed && this.app === app && this.vault === app.vault && this.artifactReader.owns(app)
    );
  }

  /**
   * Registers exact Vault listeners before performing the initial full scan.
   *
   * Registration is idempotent for one active lifecycle.
   */
  start(): void {
    if (this.started && this.crawlActivated) {
      return;
    }
    this.startListening();
    try {
      this.scan();
    } catch (error) {
      this.rollbackStart();
      throw error;
    }
  }

  /**
   * Registers exact Vault listeners without beginning the initial crawl.
   *
   * Production startup uses this split boundary to recover durable allocated
   * and bound observations after listener ownership is established but before
   * the explicit full scan. Repeated calls are idempotent for one lifecycle.
   */
  startListening(): void {
    this.assertOpen();
    if (this.started) {
      return;
    }

    this.started = true;
    this.lifecycleGeneration += 1;
    try {
      this.eventRefs.push(this.vault.on("create", this.handleCreate));
      this.eventRefs.push(this.vault.on("modify", this.handleModify));
      this.eventRefs.push(this.vault.on("delete", this.handleDelete));
      this.eventRefs.push(this.vault.on("rename", this.handleRename));
    } catch (error) {
      this.rollbackStart();
      throw error;
    }
  }

  /**
   * Invalidates old source authority synchronously and installs a new immutable plan.
   *
   * Existing asynchronous captures may finish their current adapter operation,
   * including an already-started commit. Generation checks prevent their next
   * read/commit stage and suppress stale notifications after that call returns.
   *
   * @param plan - Complete opaque replacement watch plan
   */
  replaceWatchPlan(plan: KnowledgeSourceWatchPlan): void {
    this.assertOpen();
    KnowledgeSourceWatchPlan.assert(plan);
    for (const authority of plan.getBundleAuthorities()) {
      if (!this.handoffs.get(authority.bundleId)) {
        throw new VaultSourceWatchPlanError();
      }
    }
    this.watchPlanGeneration += 1;
    this.watchPlan = plan;
    this.quarantinedSourceKeys.clear();
    this.startupBlockers.clear();
    this.sourceGenerations.clear();
    if (this.started && this.crawlActivated) {
      this.scan();
    }
  }

  /**
   * Schedules every currently loaded file that appears in the exact watch plan.
   *
   * @returns Number of per-Bundle source captures scheduled
   */
  scan(): number {
    this.assertActive();
    const lifecycleGeneration = this.lifecycleGeneration;
    const watchPlanGeneration = this.watchPlanGeneration;
    const watchPlan = this.watchPlan;
    this.crawlActivated = true;
    const files = this.vault.getFiles();
    const filesByPathKey = new Map<string, Map<string, TFile>>();
    let scheduled = 0;
    for (const file of files) {
      if (
        lifecycleGeneration !== this.lifecycleGeneration ||
        watchPlanGeneration !== this.watchPlanGeneration
      ) {
        return scheduled;
      }
      const parsed = parseVaultPath(file.path);
      if (parsed.ok) {
        const pathKey = toWindowsPathKey(parsed.path);
        const matchingPaths = filesByPathKey.get(pathKey);
        if (matchingPaths) {
          matchingPaths.set(parsed.path, file);
        } else {
          filesByPathKey.set(pathKey, new Map([[parsed.path, file]]));
        }
      }
    }
    for (const source of watchPlan.getSources()) {
      if (
        lifecycleGeneration !== this.lifecycleGeneration ||
        watchPlanGeneration !== this.watchPlanGeneration
      ) {
        return scheduled;
      }
      const matchingPaths = filesByPathKey.get(source.sourceKey);
      if (!matchingPaths || matchingPaths.size === 0) {
        this.blockSource(source, {
          kind: "source_missing",
          bundleId: source.bundleId,
          sourceId: source.sourceId,
        });
        this.emit({
          kind: "source_missing",
          bundleId: source.bundleId,
          sourceId: source.sourceId,
        });
        continue;
      }
      if (matchingPaths.size > 1) {
        this.blockSource(source, {
          kind: "source_path_invalid",
          reason: "windows_collision",
          bundleId: source.bundleId,
          sourceId: source.sourceId,
        });
        this.emit({
          kind: "source_path_invalid",
          reason: "windows_collision",
          bundleId: source.bundleId,
          sourceId: source.sourceId,
        });
        continue;
      }
      if (!matchingPaths.has(source.sourcePath)) {
        this.blockSource(source, {
          kind: "source_path_invalid",
          reason: "case_mismatch",
          bundleId: source.bundleId,
          sourceId: source.sourceId,
        });
        this.emit({
          kind: "source_path_invalid",
          reason: "case_mismatch",
          bundleId: source.bundleId,
          sourceId: source.sourceId,
        });
      }
    }
    for (const output of watchPlan.getGeneratedOutputs()) {
      if (
        lifecycleGeneration !== this.lifecycleGeneration ||
        watchPlanGeneration !== this.watchPlanGeneration
      ) {
        return scheduled;
      }
      const matchingPaths = filesByPathKey.get(output.outputKey);
      if (!matchingPaths || matchingPaths.size === 0) {
        continue;
      }
      let reason: "case_mismatch" | "windows_collision" | undefined;
      if (matchingPaths.size > 1) {
        reason = "windows_collision";
      } else if (!matchingPaths.has(output.outputPath)) {
        reason = "case_mismatch";
      }
      if (!reason) {
        continue;
      }
      this.blockGeneratedOutputOwners(
        watchPlan.getSourcesForGeneratedOutputPathKey(output.outputKey),
        reason,
        lifecycleGeneration,
        watchPlanGeneration
      );
    }
    if (
      lifecycleGeneration !== this.lifecycleGeneration ||
      watchPlanGeneration !== this.watchPlanGeneration
    ) {
      return scheduled;
    }
    for (const file of files) {
      if (
        lifecycleGeneration !== this.lifecycleGeneration ||
        watchPlanGeneration !== this.watchPlanGeneration
      ) {
        return scheduled;
      }
      scheduled += this.scheduleFile(file, "initial_scan");
    }
    return scheduled;
  }

  /**
   * Returns the authoritative blockers accumulated by this exact plan generation.
   *
   * Unlike the best-effort notification sink, this snapshot cannot be dropped
   * by an observer and is the readiness input for production startup.
   *
   * @returns Deterministically ordered, content-free blocker snapshot
   */
  getStartupBlockers(): readonly Readonly<VaultSourceWatcherStartupBlocker>[] {
    this.assertOpen();
    return Object.freeze(
      [...this.startupBlockers.values()].sort(
        (left, right) =>
          compareText(left.bundleId, right.bundleId) ||
          compareText(left.sourceId, right.sourceId) ||
          compareText(left.kind, right.kind)
      )
    );
  }

  /**
   * Waits until captures already scheduled by this watcher have settled.
   *
   * Vault events may add more work while waiting, so the method repeats until
   * the pending set is empty at an observation boundary.
   */
  async waitForIdle(): Promise<void> {
    while (this.pendingCaptures.size > 0) {
      await Promise.all([...this.pendingCaptures]);
    }
  }

  /**
   * Synchronously invalidates authority and removes only this lifecycle's EventRefs.
   *
   * In-flight adapter calls cannot be cancelled, including an already-started
   * commit. After returning they may not start a later read/commit stage or
   * publish a stale notification.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.lifecycleGeneration += 1;
    this.watchPlanGeneration += 1;
    this.closed = true;
    this.started = false;
    this.crawlActivated = false;
    this.releaseEventRefs();
  }

  /** Handles a Vault create event without awaiting inside the callback. */
  private readonly handleCreate = (file: TAbstractFile): void => {
    this.scheduleFile(file, "create");
    this.scheduleGeneratedOutputFile(file, "generated_output_create");
  };

  /** Handles a Vault modify event without awaiting inside the callback. */
  private readonly handleModify = (file: TAbstractFile): void => {
    this.scheduleFile(file, "modify");
    this.scheduleGeneratedOutputFile(file, "generated_output_modify");
  };

  /** Re-observes output owners and reports source deletion without manufacturing empty bytes. */
  private readonly handleDelete = (file: TAbstractFile): void => {
    this.scheduleGeneratedOutputPaths([file.path], "generated_output_delete");
    this.reportUnsupportedChange("delete", [file.path]);
  };

  /** Re-observes output owners and reports source rename without changing source identity. */
  private readonly handleRename = (file: TAbstractFile, oldPath: string): void => {
    this.scheduleGeneratedOutputPaths([oldPath, file.path], "generated_output_rename");
    this.reportUnsupportedChange("rename", [oldPath, file.path]);
  };

  /**
   * Captures synchronous event authority and schedules one task per matching Bundle.
   *
   * @param file - Vault file supplied by the event or initial scan
   * @param cause - Observation cause retained for diagnostics
   * @returns Number of matching source tasks
   */
  private scheduleFile(file: TAbstractFile, cause: VaultSourceCaptureCause): number {
    if (!this.started || this.closed || !(file instanceof TFile)) {
      return 0;
    }
    const parsed = parseVaultPath(file.path);
    if (!parsed.ok) {
      return 0;
    }
    const capturedPath = parsed.path;
    const lifecycleGeneration = this.lifecycleGeneration;
    const watchPlanGeneration = this.watchPlanGeneration;
    const watchPlan = this.watchPlan;
    const matchingByKey = watchPlan.getSourcesForPathKey(toWindowsPathKey(capturedPath));
    const matching = matchingByKey.filter((source) => source.sourcePath === capturedPath);
    for (const source of matchingByKey) {
      if (source.sourcePath === capturedPath) continue;
      this.blockSourceForPathReason(
        source,
        "case_mismatch",
        lifecycleGeneration,
        watchPlanGeneration
      );
    }
    let scheduled = 0;

    for (const source of matching) {
      scheduled += this.scheduleSourceCapture(
        source,
        capturedPath,
        cause,
        lifecycleGeneration,
        watchPlanGeneration
      );
    }
    return scheduled;
  }

  /**
   * Creates one source-authority capture without granting authority to its trigger path.
   *
   * @param source - Immutable source owner from the active plan
   * @param capturedPath - Exact original source path to read
   * @param cause - Event cause retained only for sanitized diagnostics
   * @param lifecycleGeneration - Synchronously captured watcher lifecycle
   * @param watchPlanGeneration - Synchronously captured plan generation
   * @returns One when a capture task was scheduled, otherwise zero
   */
  private scheduleSourceCapture(
    source: ImmutableWatchedKnowledgeSource,
    capturedPath: string,
    cause: VaultSourceCaptureCause,
    lifecycleGeneration: number,
    watchPlanGeneration: number
  ): number {
    const sourceAuthorityKey = createBundleSourceKey(source);
    if (this.quarantinedSourceKeys.has(sourceAuthorityKey)) {
      return 0;
    }
    const authority: CaptureAuthority = Object.freeze({
      lifecycleGeneration,
      watchPlanGeneration,
      sourceAuthorityKey,
      sourceGeneration: this.sourceGenerations.get(sourceAuthorityKey) ?? 0,
    });
    if (!this.isAuthorityCurrent(authority)) {
      return 0;
    }
    const handoff = this.handoffs.get(source.bundleId);
    let captureId: string;
    try {
      if (!handoff) {
        throw new VaultSourceWatchPlanError();
      }
      captureId = this.captureIdFactory();
      assertCaptureIdentifier(captureId);
      if (this.usedCaptureIds.has(captureId)) {
        throw new VaultSourceObservationContractError();
      }
      this.usedCaptureIds.add(captureId);
    } catch {
      if (!this.isAuthorityCurrent(authority)) {
        return 0;
      }
      this.blockSource(source, {
        kind: "capture_failed",
        stage: "prepare",
        bundleId: source.bundleId,
        sourceId: source.sourceId,
      });
      this.emit({
        kind: "capture_failed",
        cause,
        bundleId: source.bundleId,
        sourceId: source.sourceId,
        captureId: "",
        stage: "prepare",
      });
      return 0;
    }
    if (!this.isAuthorityCurrent(authority)) {
      return 0;
    }

    const work: SourceCaptureWork = Object.freeze({
      ...authority,
      source,
      capturedPath,
      captureId,
      cause,
      handoff,
    });
    const task = this.executeCapture(work);
    this.pendingCaptures.add(task);
    void task.finally(() => this.pendingCaptures.delete(task));
    return 1;
  }

  /**
   * Treats one exact committed output file event as a read-only source-drift signal.
   *
   * The output file is never read. Every task is bound to an original Manifest
   * source path selected by the validated reverse index.
   *
   * @param file - Vault event target
   * @param cause - Generated-output observation cause
   * @returns Number of original-source captures scheduled
   */
  private scheduleGeneratedOutputFile(file: TAbstractFile, cause: VaultSourceCaptureCause): number {
    if (!this.started || this.closed || !(file instanceof TFile)) {
      return 0;
    }
    const parsed = parseVaultPath(file.path);
    if (!parsed.ok) {
      return 0;
    }
    const lifecycleGeneration = this.lifecycleGeneration;
    const watchPlanGeneration = this.watchPlanGeneration;
    const watchPlan = this.watchPlan;
    const output = watchPlan.getGeneratedOutputForPathKey(toWindowsPathKey(parsed.path));
    if (!output) {
      return 0;
    }
    const owners = watchPlan.getSourcesForGeneratedOutputPathKey(output.outputKey);
    if (parsed.path !== output.outputPath) {
      this.blockGeneratedOutputOwners(
        owners,
        "case_mismatch",
        lifecycleGeneration,
        watchPlanGeneration
      );
      return 0;
    }

    const livePathState = this.inspectLiveGeneratedOutputPath(
      output,
      lifecycleGeneration,
      watchPlanGeneration
    );
    if (livePathState === "stale") {
      return 0;
    }
    if (livePathState !== "valid") {
      this.blockGeneratedOutputOwners(
        owners,
        livePathState,
        lifecycleGeneration,
        watchPlanGeneration
      );
      return 0;
    }

    let scheduled = 0;
    for (const source of owners) {
      scheduled += this.scheduleSourceCapture(
        source,
        source.sourcePath,
        cause,
        lifecycleGeneration,
        watchPlanGeneration
      );
    }
    return scheduled;
  }

  /**
   * Re-observes original sources affected by a generated-output delete or rename.
   *
   * Folder events include every committed output below the event path. Owners
   * are de-duplicated so one Vault event produces at most one fresh observation
   * per source even when that source owns several affected pages.
   *
   * @param paths - Old/current destructive event paths
   * @param cause - Generated-output delete or rename cause
   * @returns Number of original-source captures scheduled
   */
  private scheduleGeneratedOutputPaths(
    paths: readonly string[],
    cause: VaultSourceCaptureCause
  ): number {
    if (!this.started || this.closed) {
      return 0;
    }
    const lifecycleGeneration = this.lifecycleGeneration;
    const watchPlanGeneration = this.watchPlanGeneration;
    const watchPlan = this.watchPlan;
    const matches = new Map<string, GeneratedOutputEventMatch>();

    for (const eventPath of paths) {
      const parsed = parseVaultPath(eventPath);
      if (!parsed.ok) continue;
      const eventKey = toWindowsPathKey(parsed.path);
      for (const output of watchPlan.getGeneratedOutputs()) {
        if (output.outputKey !== eventKey && !output.outputKey.startsWith(`${eventKey}/`)) {
          continue;
        }
        const exactCase =
          output.outputPath === parsed.path || output.outputPath.startsWith(`${parsed.path}/`);
        const existing = matches.get(output.outputKey);
        if (existing) {
          matches.set(
            output.outputKey,
            Object.freeze({
              ...existing,
              caseMismatch: existing.caseMismatch || !exactCase,
            })
          );
        } else {
          matches.set(
            output.outputKey,
            Object.freeze({
              output,
              owners: watchPlan.getSourcesForGeneratedOutputPathKey(output.outputKey),
              caseMismatch: !exactCase,
            })
          );
        }
      }
    }
    if (
      matches.size === 0 ||
      !this.isPlanGenerationCurrent(lifecycleGeneration, watchPlanGeneration)
    ) {
      return 0;
    }

    const ownersToCapture = new Map<string, ImmutableWatchedKnowledgeSource>();
    for (const match of matches.values()) {
      if (!this.isPlanGenerationCurrent(lifecycleGeneration, watchPlanGeneration)) {
        return 0;
      }
      let invalidReason: "case_mismatch" | "windows_collision" | undefined;
      if (match.caseMismatch) {
        invalidReason = "case_mismatch";
      } else {
        const livePathState = this.inspectLiveGeneratedOutputPath(
          match.output,
          lifecycleGeneration,
          watchPlanGeneration
        );
        if (livePathState === "stale") {
          return 0;
        }
        if (livePathState !== "valid") {
          invalidReason = livePathState;
        }
      }
      if (invalidReason) {
        this.blockGeneratedOutputOwners(
          match.owners,
          invalidReason,
          lifecycleGeneration,
          watchPlanGeneration
        );
        continue;
      }
      for (const source of match.owners) {
        ownersToCapture.set(createBundleSourceKey(source), source);
      }
    }

    let scheduled = 0;
    const owners = [...ownersToCapture.values()].sort(
      (left, right) =>
        compareText(left.bundleId, right.bundleId) || compareText(left.sourceId, right.sourceId)
    );
    for (const source of owners) {
      scheduled += this.scheduleSourceCapture(
        source,
        source.sourcePath,
        cause,
        lifecycleGeneration,
        watchPlanGeneration
      );
    }
    return scheduled;
  }

  /**
   * Checks the current Vault for a case alias or Windows-key collision.
   *
   * An absent loaded file is accepted because create callbacks can precede a
   * refreshed snapshot and destructive events normally remove or move the page.
   * Adapter failure maps to a collision blocker so drift never gains authority.
   *
   * @param output - Committed generated-output projection
   * @param lifecycleGeneration - Captured watcher lifecycle
   * @param watchPlanGeneration - Captured plan generation
   * @returns Valid, stale, or one fail-closed path reason
   */
  private inspectLiveGeneratedOutputPath(
    output: ImmutableWatchedKnowledgeGeneratedOutput,
    lifecycleGeneration: number,
    watchPlanGeneration: number
  ): "valid" | "stale" | "case_mismatch" | "windows_collision" {
    let files: TFile[];
    try {
      files = this.vault.getFiles();
    } catch {
      return this.isPlanGenerationCurrent(lifecycleGeneration, watchPlanGeneration)
        ? "windows_collision"
        : "stale";
    }
    if (!this.isPlanGenerationCurrent(lifecycleGeneration, watchPlanGeneration)) {
      return "stale";
    }
    const matchingPaths = new Set<string>();
    for (const file of files) {
      const parsed = parseVaultPath(file.path);
      if (parsed.ok && toWindowsPathKey(parsed.path) === output.outputKey) {
        matchingPaths.add(parsed.path);
      }
    }
    if (!this.isPlanGenerationCurrent(lifecycleGeneration, watchPlanGeneration)) {
      return "stale";
    }
    if (matchingPaths.size > 1) {
      return "windows_collision";
    }
    if (matchingPaths.size === 1 && !matchingPaths.has(output.outputPath)) {
      return "case_mismatch";
    }
    return "valid";
  }

  /**
   * Quarantines every owner of an invalid generated-output path projection.
   *
   * @param owners - Exact Manifest source owners
   * @param reason - Case alias or Windows-key collision
   * @param lifecycleGeneration - Captured watcher lifecycle
   * @param watchPlanGeneration - Captured plan generation
   */
  private blockGeneratedOutputOwners(
    owners: readonly ImmutableWatchedKnowledgeSource[],
    reason: "case_mismatch" | "windows_collision",
    lifecycleGeneration: number,
    watchPlanGeneration: number
  ): void {
    for (const source of owners) {
      this.blockSourceForPathReason(source, reason, lifecycleGeneration, watchPlanGeneration);
    }
  }

  /**
   * Records one path blocker only while its exact source and plan remain current.
   *
   * @param source - Immutable source authority to quarantine
   * @param reason - Stable path validation reason
   * @param lifecycleGeneration - Captured watcher lifecycle
   * @param watchPlanGeneration - Captured plan generation
   */
  private blockSourceForPathReason(
    source: ImmutableWatchedKnowledgeSource,
    reason: "case_mismatch" | "windows_collision",
    lifecycleGeneration: number,
    watchPlanGeneration: number
  ): void {
    const sourceAuthorityKey = createBundleSourceKey(source);
    if (this.quarantinedSourceKeys.has(sourceAuthorityKey)) {
      return;
    }
    const authority: CaptureAuthority = {
      lifecycleGeneration,
      watchPlanGeneration,
      sourceAuthorityKey,
      sourceGeneration: this.sourceGenerations.get(sourceAuthorityKey) ?? 0,
    };
    if (!this.isAuthorityCurrent(authority)) {
      return;
    }
    this.blockSource(source, {
      kind: "source_path_invalid",
      reason,
      bundleId: source.bundleId,
      sourceId: source.sourceId,
    });
    this.emit({
      kind: "source_path_invalid",
      reason,
      bundleId: source.bundleId,
      sourceId: source.sourceId,
    });
  }

  /**
   * Runs allocate → exact-byte read/hash → hand-off commit for one captured event.
   *
   * @param work - Fully synchronous immutable event capture
   */
  private async executeCapture(work: SourceCaptureWork): Promise<void> {
    let stage: VaultSourceCaptureStage = "allocate";
    try {
      const allocation = await this.allocate(work);
      if (!allocation) return;

      stage = "read";
      const artifact = await this.read(work);
      if (!artifact) return;

      stage = "commit";
      const settlement = await this.commit(work, allocation, artifact.sourceContentHash);
      if (!settlement || !this.isAuthorityCurrent(work)) return;

      this.emit({
        kind: "capture_settled",
        cause: work.cause,
        bundleId: work.source.bundleId,
        sourceId: work.source.sourceId,
        captureId: work.captureId,
        inputRevision: allocation.inputRevision,
        settlement: settlement.kind,
      });
    } catch {
      if (!this.isAuthorityCurrent(work)) {
        return;
      }
      this.blockSource(work.source, {
        kind: "capture_failed",
        stage,
        bundleId: work.source.bundleId,
        sourceId: work.source.sourceId,
      });
      this.emit({
        kind: "capture_failed",
        cause: work.cause,
        bundleId: work.source.bundleId,
        sourceId: work.source.sourceId,
        captureId: work.captureId,
        stage,
      });
    }
  }

  /**
   * Allocates with bounded exact-capture replay.
   *
   * @param work - Immutable capture identity and authority
   * @returns Durable allocation, or undefined after authority invalidation
   */
  private async allocate(
    work: SourceCaptureWork
  ): Promise<SourceInputRevisionAllocation | undefined> {
    const request = Object.freeze({
      bundleId: work.source.bundleId,
      sourceId: work.source.sourceId,
      captureId: work.captureId,
    });
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAllocateAttempts; attempt += 1) {
      if (!this.isAuthorityCurrent(work)) return undefined;
      try {
        const allocation = await work.handoff.allocate(request);
        if (!this.isAuthorityCurrent(work)) return undefined;
        return verifyAllocation(allocation, work);
      } catch (error) {
        lastError = error;
        if (!this.isAuthorityCurrent(work)) return undefined;
        if (error instanceof VaultSourceObservationContractError) break;
      }
    }
    throw lastError;
  }

  /**
   * Reads captured-path bytes with bounded retry after durable allocation.
   *
   * @param work - Immutable capture identity and path
   * @returns Exact source artifact, or undefined after authority invalidation
   */
  private async read(work: SourceCaptureWork): Promise<ExactSourceArtifact | undefined> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxReadAttempts; attempt += 1) {
      if (!this.isAuthorityCurrent(work)) return undefined;
      try {
        const artifact = await this.artifactReader.read(work.capturedPath);
        if (!this.isAuthorityCurrent(work)) return undefined;
        const verified = verifySourceArtifact(artifact, work.capturedPath);
        if (
          "expectedSourceContentHash" in work.source &&
          verified.sourceContentHash !== work.source.expectedSourceContentHash
        ) {
          throw new SourceArtifactHashMismatchError();
        }
        return verified;
      } catch (error) {
        lastError = error;
        if (
          !this.isAuthorityCurrent(work) ||
          error instanceof SourceArtifactAdapterPayloadError ||
          error instanceof SourceArtifactHashMismatchError ||
          error instanceof VaultSourceObservationContractError
        ) {
          break;
        }
      }
    }
    throw lastError;
  }

  /**
   * Replays only the exact bound payload when acknowledgement is uncertain.
   *
   * @param work - Immutable capture and pipeline identity
   * @param allocation - Durable allocation returned for this capture
   * @param sourceContentHash - Hash computed from the exact captured bytes
   * @returns Durable settlement, or undefined after authority invalidation
   */
  private async commit(
    work: SourceCaptureWork,
    allocation: SourceInputRevisionAllocation,
    sourceContentHash: string
  ): Promise<CommitSourceInputObservationResult | undefined> {
    const request = Object.freeze({
      observationToken: allocation.observationToken,
      sourceContentHash,
      pipelineFingerprint: work.source.pipelineFingerprint,
    });
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxCommitAttempts; attempt += 1) {
      if (!this.isAuthorityCurrent(work)) return undefined;
      try {
        const settlement = await work.handoff.commit(request);
        if (!this.isAuthorityCurrent(work)) return undefined;
        return verifySettlement(settlement, work, allocation, sourceContentHash);
      } catch (error) {
        lastError = error;
        if (!this.isAuthorityCurrent(work)) return undefined;
        if (error instanceof VaultSourceObservationContractError) break;
      }
    }
    throw lastError;
  }

  /**
   * Finds exact or descendant planned sources affected by a destructive event.
   *
   * @param change - Unsupported source lifecycle change
   * @param paths - Old and/or current event paths
   */
  private reportUnsupportedChange(change: "delete" | "rename", paths: readonly string[]): void {
    if (!this.started || this.closed) {
      return;
    }
    const lifecycleGeneration = this.lifecycleGeneration;
    const watchPlanGeneration = this.watchPlanGeneration;
    const watchPlan = this.watchPlan;
    const affected = new Map<string, ImmutableWatchedKnowledgeSource>();
    for (const path of paths) {
      const parsed = parseVaultPath(path);
      if (!parsed.ok) continue;
      const eventKey = toWindowsPathKey(parsed.path);
      for (const source of watchPlan.getSources()) {
        if (source.sourceKey === eventKey || source.sourceKey.startsWith(`${eventKey}/`)) {
          affected.set(createBundleSourceKey(source), source);
        }
      }
    }
    if (affected.size === 0) {
      return;
    }
    for (const source of affected.values()) {
      this.blockSource(source, {
        kind: "source_change_unsupported",
        change,
        bundleId: source.bundleId,
        sourceId: source.sourceId,
      });
    }
    for (const source of affected.values()) {
      if (
        lifecycleGeneration !== this.lifecycleGeneration ||
        watchPlanGeneration !== this.watchPlanGeneration
      ) {
        return;
      }
      this.emit({
        kind: "source_change_unsupported",
        change,
        bundleId: source.bundleId,
        sourceId: source.sourceId,
      });
    }
  }

  /**
   * Checks exact lifecycle and watch-plan identity without selecting a source.
   *
   * @param lifecycleGeneration - Captured watcher lifecycle
   * @param watchPlanGeneration - Captured watch-plan generation
   * @returns Whether current synchronous routing may continue
   */
  private isPlanGenerationCurrent(
    lifecycleGeneration: number,
    watchPlanGeneration: number
  ): boolean {
    return (
      !this.closed &&
      this.started &&
      lifecycleGeneration === this.lifecycleGeneration &&
      watchPlanGeneration === this.watchPlanGeneration
    );
  }

  /**
   * Checks exact lifecycle and plan authority around every asynchronous boundary.
   *
   * @param authority - Captured lifecycle and plan generations
   * @returns Whether the work may start its next operation
   */
  private isAuthorityCurrent(authority: CaptureAuthority): boolean {
    return (
      !this.closed &&
      this.started &&
      authority.lifecycleGeneration === this.lifecycleGeneration &&
      authority.watchPlanGeneration === this.watchPlanGeneration &&
      authority.sourceGeneration === (this.sourceGenerations.get(authority.sourceAuthorityKey) ?? 0)
    );
  }

  /**
   * Quarantines one source and retains an authoritative in-memory readiness blocker.
   *
   * A second reason may be recorded for diagnostics, but source authority is
   * invalidated only on the first transition into quarantine.
   *
   * @param source - Current immutable source authority
   * @param blocker - Sanitized reason this generation cannot become ready
   */
  private blockSource(
    source: ImmutableWatchedKnowledgeSource,
    blocker: VaultSourceWatcherStartupBlocker
  ): void {
    const sourceAuthorityKey = createBundleSourceKey(source);
    if (!this.quarantinedSourceKeys.has(sourceAuthorityKey)) {
      this.sourceGenerations.set(
        sourceAuthorityKey,
        (this.sourceGenerations.get(sourceAuthorityKey) ?? 0) + 1
      );
      this.quarantinedSourceKeys.add(sourceAuthorityKey);
    }
    let detail = "";
    if ("stage" in blocker) {
      detail = blocker.stage;
    } else if ("reason" in blocker) {
      detail = blocker.reason;
    } else if ("change" in blocker) {
      detail = blocker.change;
    }
    const blockerKey = `${sourceAuthorityKey.length}:${sourceAuthorityKey}${blocker.kind}:${detail}`;
    this.startupBlockers.set(blockerKey, Object.freeze({ ...blocker }));
  }

  /** Rejects mutation after permanent lifecycle closure. */
  private assertOpen(): void {
    if (this.closed) {
      throw new VaultSourceWatcherClosedError();
    }
  }

  /** Rejects an explicit scan before listeners own the lifecycle. */
  private assertActive(): void {
    this.assertOpen();
    if (!this.started) {
      throw new Error("The knowledge source watcher has not started");
    }
  }

  /** Removes only the EventRefs created by this exact Vault owner. */
  private releaseEventRefs(): void {
    for (const ref of this.eventRefs.splice(0)) {
      try {
        this.vault.offref(ref);
      } catch {
        // Cleanup is best effort after authority has already been invalidated.
      }
    }
  }

  /** Restores the pre-start state after listener registration or initial scan fails. */
  private rollbackStart(): void {
    this.lifecycleGeneration += 1;
    this.started = false;
    this.crawlActivated = false;
    this.quarantinedSourceKeys.clear();
    this.startupBlockers.clear();
    this.sourceGenerations.clear();
    this.releaseEventRefs();
  }

  /**
   * Emits one non-authoritative notification without letting observers affect capture.
   *
   * @param notification - Sanitized watcher hint
   */
  private emit(notification: VaultSourceWatcherNotification): void {
    try {
      this.notificationSink?.emit(Object.freeze(notification));
    } catch {
      // Notifications never own durable state or watcher progress.
    }
  }
}
