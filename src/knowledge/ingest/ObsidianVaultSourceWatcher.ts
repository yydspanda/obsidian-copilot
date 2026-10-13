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
import { MAX_KNOWLEDGE_SOURCE_BYTES } from "@/knowledge/parser/KnowledgeByteParser";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_STAGE_ATTEMPTS = 2;
const MAX_PENDING_SOURCE_ISSUE_HINT_BUNDLES = 10_000;

// eslint-disable-next-line @typescript-eslint/unbound-method -- capture the intrinsic getter for a non-spoofable receiver check
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength"
)?.get;

export interface VaultSourceObservationHandoffPort {
  allocate(request: AllocateSourceInputRevisionRequest): Promise<SourceInputRevisionAllocation>;

  commit(request: BindSourceInputObservationRequest): Promise<CommitSourceInputObservationResult>;
}

export interface ExactSourceArtifact {
  sourcePath: string;
  bytes: Uint8Array;
  sourceContentHash: string;
}

export type VaultSourceCaptureCause =
  | "initial_scan"
  | "create"
  | "modify"
  | "generated_output_create"
  | "generated_output_modify"
  | "generated_output_delete"
  | "generated_output_rename";

export type VaultSourceCaptureStage = "prepare" | "allocate" | "read" | "commit";

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

export type VaultSourceWatcherRecoverableIssue = Extract<
  VaultSourceWatcherStartupBlocker,
  { kind: "source_missing" | "source_change_unsupported" }
>;

export interface VaultSourceWatcherNotificationSink {
  emit(notification: VaultSourceWatcherNotification): void;
}

export interface ObsidianVaultSourceWatcherOptions {
  captureIdFactory?: () => string;
  artifactReader?: ObsidianExactSourceArtifactReader;
  notificationSink?: VaultSourceWatcherNotificationSink;
  maxAllocateAttempts?: number;
  maxReadAttempts?: number;
  maxCommitAttempts?: number;
}

export class VaultSourceWatchPlanError extends TypeError {
  constructor() {
    super("The knowledge source watcher dependencies are invalid");
    this.name = "VaultSourceWatchPlanError";
  }
}

export class VaultSourceWatcherClosedError extends Error {
  constructor() {
    super("The knowledge source watcher lifecycle is closed");
    this.name = "VaultSourceWatcherClosedError";
  }
}

export class SourceArtifactUnavailableError extends Error {
  constructor() {
    super("The source artifact is unavailable");
    this.name = "SourceArtifactUnavailableError";
  }
}

export class SourceArtifactAdapterPayloadError extends Error {
  constructor() {
    super("The source artifact adapter returned an invalid payload");
    this.name = "SourceArtifactAdapterPayloadError";
  }
}

export class SourceArtifactSizeLimitError extends Error {
  constructor() {
    super("The source artifact exceeds the byte limit");
    this.name = "SourceArtifactSizeLimitError";
  }
}

export class SourceArtifactHashMismatchError extends Error {
  constructor() {
    super("The source artifact no longer matches the expected content hash");
    this.name = "SourceArtifactHashMismatchError";
  }
}

export class VaultSourceObservationContractError extends Error {
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

interface SourceIssueHintSubscription {
  readonly listener: () => void;
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function requireAttemptCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Watcher stage attempts must be positive safe integers");
  }
  return value;
}

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

function assertCaptureIdentifier(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VaultSourceObservationContractError();
  }
}

function createBundleSourceKey(
  source: Pick<WatchedKnowledgeSource, "bundleId" | "sourceId">
): string {
  return `${source.bundleId.length}:${source.bundleId}${source.sourceId}`;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecoverableSourceIssue(
  blocker: Readonly<VaultSourceWatcherStartupBlocker>
): blocker is Readonly<VaultSourceWatcherRecoverableIssue> {
  return blocker.kind === "source_missing" || blocker.kind === "source_change_unsupported";
}

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

export class ObsidianExactSourceArtifactReader {
  private readonly app: App;
  private readonly vault: Vault;
  private readonly adapter: Vault["adapter"];
  private readonly maxBytes: number;

  constructor(app: App, maxBytes = MAX_KNOWLEDGE_SOURCE_BYTES) {
    // Invalid budgets must not silently disable the read boundary.
    // https://github.com/yydspanda/obsidian-copilot/issues/11
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new TypeError("Source byte limit must be a positive safe integer");
    }
    this.app = app;
    this.vault = app.vault;
    this.adapter = app.vault.adapter;
    this.maxBytes = maxBytes;
  }

  owns(app: App): boolean {
    return this.app === app && this.vault === app.vault && this.adapter === app.vault.adapter;
  }

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

    // Cached TFile stats can predate a large replacement; bound the fresh source before loading it.
    // https://github.com/yydspanda/obsidian-copilot/issues/11
    const stat = await this.adapter.stat(parsed.path);
    throwIfAborted(signal);
    if (!stat || stat.type !== "file") {
      throw new SourceArtifactUnavailableError();
    }
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
      throw new SourceArtifactAdapterPayloadError();
    }
    if (stat.size > this.maxBytes) {
      throw new SourceArtifactSizeLimitError();
    }

    const payload: unknown = await this.adapter.readBinary(parsed.path);
    throwIfAborted(signal);
    if (!isArrayBuffer(payload)) {
      throw new SourceArtifactAdapterPayloadError();
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(payload);
    } catch {
      throw new SourceArtifactAdapterPayloadError();
    }
    // A source can grow after stat. Check the view's actual length before copying or hashing it.
    // https://github.com/yydspanda/obsidian-copilot/issues/11
    if (bytes.byteLength > this.maxBytes) {
      throw new SourceArtifactSizeLimitError();
    }
    bytes = new Uint8Array(bytes);
    return {
      sourcePath: parsed.path,
      bytes,
      sourceContentHash: createSourceContentHash(bytes),
    };
  }

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
  private readonly sourceIssueListeners = new Map<string, Set<SourceIssueHintSubscription>>();
  private readonly pendingSourceIssueHintBundles = new Set<string>();
  private sourceIssueHintGeneration = 0;
  private sourceIssueHintFlushScheduled = false;

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

  owns(app: App): boolean {
    return (
      !this.closed && this.app === app && this.vault === app.vault && this.artifactReader.owns(app)
    );
  }

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

  replaceWatchPlan(plan: KnowledgeSourceWatchPlan): void {
    this.assertOpen();
    KnowledgeSourceWatchPlan.assert(plan);
    for (const authority of plan.getBundleAuthorities()) {
      if (!this.handoffs.get(authority.bundleId)) {
        throw new VaultSourceWatchPlanError();
      }
    }
    const changedIssueBundles = new Set(
      [...this.startupBlockers.values()]
        .filter(isRecoverableSourceIssue)
        .map((issue) => issue.bundleId)
    );
    this.watchPlanGeneration += 1;
    this.invalidatePendingSourceIssueHints();
    this.watchPlan = plan;
    this.quarantinedSourceKeys.clear();
    this.startupBlockers.clear();
    this.sourceGenerations.clear();
    if (this.started && this.crawlActivated) {
      this.scan();
    }
    for (const bundleId of changedIssueBundles) {
      this.scheduleSourceIssueHint(bundleId);
    }
  }

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

  subscribeSourceIssueChanges(bundleId: string, listener: () => void): () => void {
    this.assertActive();
    if (
      typeof bundleId !== "string" ||
      bundleId.length === 0 ||
      typeof listener !== "function" ||
      !this.watchPlan.getBundleAuthorities().some((authority) => authority.bundleId === bundleId)
    ) {
      throw new VaultSourceWatchPlanError();
    }
    const listeners =
      this.sourceIssueListeners.get(bundleId) ?? new Set<SourceIssueHintSubscription>();
    const subscription: SourceIssueHintSubscription = Object.freeze({ listener });
    listeners.add(subscription);
    this.sourceIssueListeners.set(bundleId, listeners);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.sourceIssueListeners.get(bundleId);
      current?.delete(subscription);
      if (current?.size === 0) this.sourceIssueListeners.delete(bundleId);
    };
  }

  async waitForIdle(): Promise<void> {
    while (this.pendingCaptures.size > 0) {
      await Promise.all([...this.pendingCaptures]);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.lifecycleGeneration += 1;
    this.watchPlanGeneration += 1;
    this.closed = true;
    this.started = false;
    this.crawlActivated = false;
    this.invalidatePendingSourceIssueHints();
    this.sourceIssueListeners.clear();
    this.releaseEventRefs();
  }

  private readonly handleCreate = (file: TAbstractFile): void => {
    this.releaseRecoverableQuarantineForCreate(file);
    this.scheduleFile(file, "create");
    this.scheduleGeneratedOutputFile(file, "generated_output_create");
  };

  private readonly handleModify = (file: TAbstractFile): void => {
    this.scheduleFile(file, "modify");
    this.scheduleGeneratedOutputFile(file, "generated_output_modify");
  };

  private readonly handleDelete = (file: TAbstractFile): void => {
    this.scheduleGeneratedOutputPaths([file.path], "generated_output_delete");
    this.reportUnsupportedChange("delete", [file.path]);
  };

  private readonly handleRename = (file: TAbstractFile, oldPath: string): void => {
    this.scheduleGeneratedOutputPaths([oldPath, file.path], "generated_output_rename");
    this.reportUnsupportedChange("rename", [oldPath, file.path]);
  };

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

      this.clearRecoverableSourceIssues(work.source);

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
          // Retrying a known oversized source can repeat the same expensive adapter read.
          // https://github.com/yydspanda/obsidian-copilot/issues/11
          error instanceof SourceArtifactSizeLimitError ||
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

  private releaseRecoverableQuarantineForCreate(file: TAbstractFile): void {
    if (!this.started || this.closed || !(file instanceof TFile)) {
      return;
    }
    const parsed = parseVaultPath(file.path);
    if (!parsed.ok) {
      return;
    }
    const lifecycleGeneration = this.lifecycleGeneration;
    const watchPlanGeneration = this.watchPlanGeneration;
    const matchingSources = this.watchPlan
      .getSourcesForPathKey(toWindowsPathKey(parsed.path))
      .filter((source) => source.sourcePath === parsed.path);

    for (const source of matchingSources) {
      if (!this.isPlanGenerationCurrent(lifecycleGeneration, watchPlanGeneration)) {
        return;
      }
      const sourceAuthorityKey = createBundleSourceKey(source);
      const blockers = this.getBlockersForSource(source);
      if (blockers.length === 0 || blockers.some((blocker) => !isRecoverableSourceIssue(blocker))) {
        continue;
      }
      this.sourceGenerations.set(
        sourceAuthorityKey,
        (this.sourceGenerations.get(sourceAuthorityKey) ?? 0) + 1
      );
      this.quarantinedSourceKeys.delete(sourceAuthorityKey);
    }
  }

  private clearRecoverableSourceIssues(source: ImmutableWatchedKnowledgeSource): void {
    let changed = false;
    for (const [blockerKey, blocker] of this.startupBlockers) {
      if (
        blocker.bundleId === source.bundleId &&
        blocker.sourceId === source.sourceId &&
        isRecoverableSourceIssue(blocker)
      ) {
        this.startupBlockers.delete(blockerKey);
        changed = true;
      }
    }
    if (this.getBlockersForSource(source).length === 0) {
      this.quarantinedSourceKeys.delete(createBundleSourceKey(source));
    }
    if (changed) this.scheduleSourceIssueHint(source.bundleId);
  }

  private getBlockersForSource(
    source: Pick<WatchedKnowledgeSource, "bundleId" | "sourceId">
  ): readonly Readonly<VaultSourceWatcherStartupBlocker>[] {
    return [...this.startupBlockers.values()].filter(
      (blocker) => blocker.bundleId === source.bundleId && blocker.sourceId === source.sourceId
    );
  }

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

  private isAuthorityCurrent(authority: CaptureAuthority): boolean {
    return (
      !this.closed &&
      this.started &&
      authority.lifecycleGeneration === this.lifecycleGeneration &&
      authority.watchPlanGeneration === this.watchPlanGeneration &&
      authority.sourceGeneration === (this.sourceGenerations.get(authority.sourceAuthorityKey) ?? 0)
    );
  }

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
    const issueChanged = isRecoverableSourceIssue(blocker) && !this.startupBlockers.has(blockerKey);
    this.startupBlockers.set(blockerKey, Object.freeze({ ...blocker }));
    if (issueChanged) this.scheduleSourceIssueHint(blocker.bundleId);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new VaultSourceWatcherClosedError();
    }
  }

  private assertActive(): void {
    this.assertOpen();
    if (!this.started) {
      throw new Error("The knowledge source watcher has not started");
    }
  }

  private releaseEventRefs(): void {
    for (const ref of this.eventRefs.splice(0)) {
      try {
        this.vault.offref(ref);
      } catch {
        // Cleanup is best effort after authority has already been invalidated.
        // https://github.com/yydspanda/obsidian-copilot/issues/24
      }
    }
  }

  private rollbackStart(): void {
    this.lifecycleGeneration += 1;
    this.started = false;
    this.crawlActivated = false;
    this.quarantinedSourceKeys.clear();
    this.startupBlockers.clear();
    this.sourceGenerations.clear();
    this.invalidatePendingSourceIssueHints();
    this.sourceIssueListeners.clear();
    this.releaseEventRefs();
  }

  private scheduleSourceIssueHint(bundleId: string): void {
    if (
      this.closed ||
      !this.started ||
      !this.sourceIssueListeners.has(bundleId) ||
      (!this.pendingSourceIssueHintBundles.has(bundleId) &&
        this.pendingSourceIssueHintBundles.size >= MAX_PENDING_SOURCE_ISSUE_HINT_BUNDLES)
    ) {
      return;
    }
    this.pendingSourceIssueHintBundles.add(bundleId);
    if (this.sourceIssueHintFlushScheduled) return;
    this.sourceIssueHintFlushScheduled = true;
    const generation = this.sourceIssueHintGeneration;
    queueMicrotask(() => this.flushSourceIssueHints(generation));
  }

  private flushSourceIssueHints(generation: number): void {
    if (generation !== this.sourceIssueHintGeneration || this.closed || !this.started) {
      return;
    }
    this.sourceIssueHintFlushScheduled = false;
    const bundleIds = [...this.pendingSourceIssueHintBundles].sort(compareText);
    this.pendingSourceIssueHintBundles.clear();
    for (const bundleId of bundleIds) {
      const listeners = this.sourceIssueListeners.get(bundleId);
      if (!listeners) continue;
      for (const subscription of [...listeners]) {
        if (!this.sourceIssueListeners.get(bundleId)?.has(subscription)) continue;
        try {
          subscription.listener();
        } catch {
          // Issue hints are advisory and cannot interrupt watcher progress.
          // https://github.com/yydspanda/obsidian-copilot/issues/24
        }
      }
    }
  }

  private invalidatePendingSourceIssueHints(): void {
    this.sourceIssueHintGeneration += 1;
    this.sourceIssueHintFlushScheduled = false;
    this.pendingSourceIssueHintBundles.clear();
  }

  private emit(notification: VaultSourceWatcherNotification): void {
    try {
      this.notificationSink?.emit(Object.freeze(notification));
    } catch {
      // Notifications never own durable state or watcher progress.
      // https://github.com/yydspanda/obsidian-copilot/issues/24
    }
  }
}
