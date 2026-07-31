import { App, EventRef, TAbstractFile, TFile, Vault } from "obsidian";

import type {
  AllocateSourceInputRevisionRequest,
  BindSourceInputObservationRequest,
  SourceInputRevisionAllocation,
} from "@/knowledge/ingest/InputRevisionAllocator";
import type { CommitSourceInputObservationResult } from "@/knowledge/ingest/SourceObservationHandoff";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_STAGE_ATTEMPTS = 2;

/** One already-registered source that the watcher may observe. */
export interface WatchedKnowledgeSource {
  bundleId: string;
  sourceId: string;
  sourcePath: string;
  sourceKey: string;
  pipelineFingerprint: string;
}

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
export type VaultSourceCaptureCause = "initial_scan" | "create" | "modify";

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

/** Reports invalid or conflicting immutable watcher input. */
export class VaultSourceWatchPlanError extends TypeError {
  /** Creates a sanitized invalid-plan error. */
  constructor() {
    super("The knowledge source watch plan is invalid");
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

interface PreparedWatchPlan {
  sources: readonly ImmutableWatchedKnowledgeSource[];
  sourcesByPathKey: ReadonlyMap<string, readonly ImmutableWatchedKnowledgeSource[]>;
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
 * @returns Whether the value exposes the ArrayBuffer intrinsic tag
 */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/**
 * Tests whether an unknown value is a Uint8Array in any renderer realm.
 *
 * @param value - Unknown exact-byte reader result
 * @returns Whether the value is a Uint8Array view
 */
function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]"
  );
}

/**
 * Validates a non-empty opaque identity without normalizing it.
 *
 * @param value - Identity supplied by a durable upstream adapter
 */
function assertIdentifier(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VaultSourceWatchPlanError();
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

/**
 * Produces the stable key for one Bundle/Windows-path pair.
 *
 * @param source - Registered source identity and Windows path key
 * @returns Collision key independent of path spelling
 */
function createBundlePathKey(
  source: Pick<WatchedKnowledgeSource, "bundleId" | "sourceKey">
): string {
  return `${source.bundleId.length}:${source.bundleId}${source.sourceKey}`;
}

/**
 * Validates, freezes, sorts, and deduplicates one immutable watch plan.
 *
 * The same physical path may intentionally feed multiple Bundles. Within one
 * Bundle, however, both source id and Windows path ownership must be unique.
 *
 * @param sources - Already-registered sources with immutable pipeline identity
 * @returns Detached plan and Windows path lookup
 */
function prepareWatchPlan(sources: readonly WatchedKnowledgeSource[]): PreparedWatchPlan {
  const bySource = new Map<string, ImmutableWatchedKnowledgeSource>();
  const byBundlePath = new Map<string, ImmutableWatchedKnowledgeSource>();

  for (const input of sources) {
    assertIdentifier(input.bundleId);
    assertIdentifier(input.sourceId);
    const parsedPath = parseVaultPath(input.sourcePath);
    if (
      !parsedPath.ok ||
      input.sourceKey !== toWindowsPathKey(parsedPath.path) ||
      !SHA256_PATTERN.test(input.pipelineFingerprint)
    ) {
      throw new VaultSourceWatchPlanError();
    }

    const source = Object.freeze({
      bundleId: input.bundleId,
      sourceId: input.sourceId,
      sourcePath: parsedPath.path,
      sourceKey: input.sourceKey,
      pipelineFingerprint: input.pipelineFingerprint,
    });
    const sourceIdentityKey = createBundleSourceKey(source);
    const pathIdentityKey = createBundlePathKey(source);
    const existingSource = bySource.get(sourceIdentityKey);
    const existingPath = byBundlePath.get(pathIdentityKey);

    if (
      (existingSource &&
        (existingSource.sourceKey !== source.sourceKey ||
          existingSource.sourcePath !== source.sourcePath ||
          existingSource.pipelineFingerprint !== source.pipelineFingerprint)) ||
      (existingPath &&
        (existingPath.sourceId !== source.sourceId ||
          existingPath.sourcePath !== source.sourcePath ||
          existingPath.pipelineFingerprint !== source.pipelineFingerprint))
    ) {
      throw new VaultSourceWatchPlanError();
    }

    bySource.set(sourceIdentityKey, existingSource ?? source);
    byBundlePath.set(pathIdentityKey, existingPath ?? source);
  }

  const preparedSources = [...bySource.values()].sort((left, right) => {
    if (left.sourceKey < right.sourceKey) return -1;
    if (left.sourceKey > right.sourceKey) return 1;
    if (left.bundleId < right.bundleId) return -1;
    if (left.bundleId > right.bundleId) return 1;
    if (left.sourceId < right.sourceId) return -1;
    if (left.sourceId > right.sourceId) return 1;
    return 0;
  });
  const sourcesByPathKey = new Map<string, ImmutableWatchedKnowledgeSource[]>();
  for (const source of preparedSources) {
    const matching = sourcesByPathKey.get(source.sourceKey);
    if (matching) {
      matching.push(source);
    } else {
      sourcesByPathKey.set(source.sourceKey, [source]);
    }
  }
  for (const matching of sourcesByPathKey.values()) {
    Object.freeze(matching);
  }

  return {
    sources: Object.freeze(preparedSources),
    sourcesByPathKey,
  };
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
  if (
    typeof artifact !== "object" ||
    artifact === null ||
    artifact.sourcePath !== capturedPath ||
    !isUint8Array(artifact.bytes)
  ) {
    throw new VaultSourceObservationContractError();
  }
  const bytes = artifact.bytes.slice();
  const sourceContentHash = createSourceContentHash(bytes);
  if (
    !SHA256_PATTERN.test(artifact.sourceContentHash) ||
    artifact.sourceContentHash !== sourceContentHash
  ) {
    throw new VaultSourceObservationContractError();
  }
  return { sourcePath: capturedPath, bytes, sourceContentHash };
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
  if (
    typeof allocation !== "object" ||
    allocation === null ||
    allocation.bundleId !== work.source.bundleId ||
    allocation.sourceId !== work.source.sourceId ||
    allocation.captureId !== work.captureId ||
    !Number.isSafeInteger(allocation.inputRevision) ||
    allocation.inputRevision < 1 ||
    typeof allocation.observationToken !== "string" ||
    allocation.observationToken.trim().length === 0
  ) {
    throw new VaultSourceObservationContractError();
  }
  return Object.freeze({
    bundleId: allocation.bundleId,
    sourceId: allocation.sourceId,
    captureId: allocation.captureId,
    inputRevision: allocation.inputRevision,
    observationToken: allocation.observationToken,
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
  if (typeof settlement !== "object" || settlement === null) {
    throw new VaultSourceObservationContractError();
  }
  if (settlement.kind === "committed") {
    const { observation } = settlement;
    if (
      typeof observation !== "object" ||
      observation === null ||
      observation.bundleId !== work.source.bundleId ||
      observation.sourceId !== work.source.sourceId ||
      observation.captureId !== work.captureId ||
      observation.inputRevision !== allocation.inputRevision ||
      observation.observationToken !== allocation.observationToken ||
      observation.sourceContentHash !== sourceContentHash ||
      observation.pipelineFingerprint !== work.source.pipelineFingerprint ||
      !Number.isSafeInteger(settlement.queueRevision) ||
      settlement.queueRevision < 1
    ) {
      throw new VaultSourceObservationContractError();
    }
    return settlement;
  }
  if (
    settlement.kind !== "superseded" ||
    settlement.bundleId !== work.source.bundleId ||
    settlement.sourceId !== work.source.sourceId ||
    settlement.captureId !== work.captureId ||
    settlement.inputRevision !== allocation.inputRevision ||
    !Number.isSafeInteger(settlement.supersededByInputRevision) ||
    settlement.supersededByInputRevision <= allocation.inputRevision
  ) {
    throw new VaultSourceObservationContractError();
  }
  return settlement;
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

    const bytes = new Uint8Array(payload).slice();
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
 * Manifest, run startup recovery, or claim Queue work. It observes create,
 * modify, and explicit full-scan inputs only. Rename and delete remain
 * fail-closed until their source-lifecycle contract exists.
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
  private watchPlan: PreparedWatchPlan;
  private lifecycleGeneration = 0;
  private watchPlanGeneration = 1;
  private started = false;
  private closed = false;
  private readonly eventRefs: EventRef[] = [];
  private readonly pendingCaptures = new Set<Promise<void>>();
  private readonly quarantinedSourceKeys = new Set<string>();
  private readonly sourceGenerations = new Map<string, number>();
  private readonly usedCaptureIds = new Set<string>();

  /**
   * Creates one exact App/Vault watcher over an immutable registered-source plan.
   *
   * @param app - Exact plugin lifecycle owner
   * @param sources - Registered source identities and precomputed pipeline hashes
   * @param handoffs - Per-Bundle durable hand-off capabilities
   * @param options - Retry, reader, id, and notification seams
   */
  constructor(
    app: App,
    sources: readonly WatchedKnowledgeSource[],
    handoffs: ReadonlyMap<string, VaultSourceObservationHandoffPort>,
    options: ObsidianVaultSourceWatcherOptions = {}
  ) {
    this.app = app;
    this.vault = app.vault;
    this.watchPlan = prepareWatchPlan(sources);
    this.handoffs = new Map(handoffs);
    for (const source of this.watchPlan.sources) {
      if (!this.handoffs.has(source.bundleId)) {
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
      this.scan();
    } catch (error) {
      this.lifecycleGeneration += 1;
      this.started = false;
      this.releaseEventRefs();
      throw error;
    }
  }

  /**
   * Invalidates old source authority synchronously and installs a new immutable plan.
   *
   * Existing asynchronous captures may finish their current adapter operation,
   * but generation checks prevent their next read/commit/publication step.
   *
   * @param sources - Complete replacement registered-source plan
   */
  replaceWatchPlan(sources: readonly WatchedKnowledgeSource[]): void {
    this.assertOpen();
    const replacement = prepareWatchPlan(sources);
    for (const source of replacement.sources) {
      if (!this.handoffs.has(source.bundleId)) {
        throw new VaultSourceWatchPlanError();
      }
    }
    this.watchPlanGeneration += 1;
    this.watchPlan = replacement;
    this.quarantinedSourceKeys.clear();
    this.sourceGenerations.clear();
    if (this.started) {
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
    const observedPathKeys = new Set<string>();
    let scheduled = 0;
    for (const file of this.vault.getFiles()) {
      const parsed = parseVaultPath(file.path);
      if (parsed.ok) {
        observedPathKeys.add(toWindowsPathKey(parsed.path));
      }
      scheduled += this.scheduleFile(file, "initial_scan");
    }
    for (const source of this.watchPlan.sources) {
      if (!observedPathKeys.has(source.sourceKey)) {
        this.emit({
          kind: "source_missing",
          bundleId: source.bundleId,
          sourceId: source.sourceId,
        });
      }
    }
    return scheduled;
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
   * In-flight adapter calls cannot be cancelled, but after returning they may
   * not read again, commit, or publish a notification.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.lifecycleGeneration += 1;
    this.watchPlanGeneration += 1;
    this.closed = true;
    this.started = false;
    this.releaseEventRefs();
  }

  /** Handles a Vault create event without awaiting inside the callback. */
  private readonly handleCreate = (file: TAbstractFile): void => {
    this.scheduleFile(file, "create");
  };

  /** Handles a Vault modify event without awaiting inside the callback. */
  private readonly handleModify = (file: TAbstractFile): void => {
    this.scheduleFile(file, "modify");
  };

  /** Reports registered source deletion without manufacturing empty bytes. */
  private readonly handleDelete = (file: TAbstractFile): void => {
    this.reportUnsupportedChange("delete", [file.path]);
  };

  /** Reports registered source rename without mutating durable source identity. */
  private readonly handleRename = (file: TAbstractFile, oldPath: string): void => {
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
    const matching = this.watchPlan.sourcesByPathKey.get(toWindowsPathKey(capturedPath)) ?? [];
    let scheduled = 0;

    for (const source of matching) {
      const sourceAuthorityKey = createBundleSourceKey(source);
      if (this.quarantinedSourceKeys.has(sourceAuthorityKey)) {
        continue;
      }
      const authority: CaptureAuthority = Object.freeze({
        lifecycleGeneration: this.lifecycleGeneration,
        watchPlanGeneration: this.watchPlanGeneration,
        sourceAuthorityKey,
        sourceGeneration: this.sourceGenerations.get(sourceAuthorityKey) ?? 0,
      });
      const handoff = this.handoffs.get(source.bundleId);
      let captureId: string;
      try {
        if (!handoff) {
          throw new VaultSourceWatchPlanError();
        }
        captureId = this.captureIdFactory();
        assertIdentifier(captureId);
        if (this.usedCaptureIds.has(captureId)) {
          throw new VaultSourceObservationContractError();
        }
        this.usedCaptureIds.add(captureId);
      } catch {
        if (!this.isAuthorityCurrent(authority)) {
          continue;
        }
        this.emit({
          kind: "capture_failed",
          cause,
          bundleId: source.bundleId,
          sourceId: source.sourceId,
          captureId: "",
          stage: "prepare",
        });
        continue;
      }
      if (!this.isAuthorityCurrent(authority)) {
        continue;
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
      scheduled += 1;
    }
    return scheduled;
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
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAllocateAttempts; attempt += 1) {
      if (!this.isAuthorityCurrent(work)) return undefined;
      try {
        const allocation = await work.handoff.allocate({
          bundleId: work.source.bundleId,
          sourceId: work.source.sourceId,
          captureId: work.captureId,
        });
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
        return verifySourceArtifact(artifact, work.capturedPath);
      } catch (error) {
        lastError = error;
        if (
          !this.isAuthorityCurrent(work) ||
          error instanceof SourceArtifactAdapterPayloadError ||
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
    const affected = new Map<string, ImmutableWatchedKnowledgeSource>();
    for (const path of paths) {
      const parsed = parseVaultPath(path);
      if (!parsed.ok) continue;
      const eventKey = toWindowsPathKey(parsed.path);
      for (const source of this.watchPlan.sources) {
        if (source.sourceKey === eventKey || source.sourceKey.startsWith(`${eventKey}/`)) {
          affected.set(createBundleSourceKey(source), source);
        }
      }
    }
    if (affected.size === 0) {
      return;
    }
    for (const source of affected.values()) {
      const sourceAuthorityKey = createBundleSourceKey(source);
      this.sourceGenerations.set(
        sourceAuthorityKey,
        (this.sourceGenerations.get(sourceAuthorityKey) ?? 0) + 1
      );
      this.quarantinedSourceKeys.add(sourceAuthorityKey);
    }
    for (const source of affected.values()) {
      this.emit({
        kind: "source_change_unsupported",
        change,
        bundleId: source.bundleId,
        sourceId: source.sourceId,
      });
    }
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
