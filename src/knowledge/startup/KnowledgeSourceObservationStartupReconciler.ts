import type {
  BindSourceInputObservationRequest,
  BoundSourceInputObservation,
  SourceInputObservationRecoveryWork,
} from "@/knowledge/ingest/InputRevisionAllocator";
import { KnowledgeSourceWatchPlan } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { CommitSourceInputObservationResult } from "@/knowledge/ingest/SourceObservationHandoff";
import { createSourceContentHash, isExactUint8Array } from "@/knowledge/model/fingerprint";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_RECOVERY_WORK_PER_BUNDLE = 10_000;
const COMMIT_ATTEMPTS = 2;

export interface KnowledgeSourceObservationExpectedArtifact {
  sourcePath: string;
  bytes: Uint8Array;
  sourceContentHash: string;
}

export interface KnowledgeSourceObservationExactReaderPort {
  readExpected(
    sourcePath: string,
    expectedContentHash: string,
    signal?: AbortSignal
  ): Promise<KnowledgeSourceObservationExpectedArtifact>;
}

export interface KnowledgeSourceObservationRecoveryHandoffPort {
  loadRecoveryWork(bundleId: string): Promise<SourceInputObservationRecoveryWork[]>;

  commit(request: BindSourceInputObservationRequest): Promise<CommitSourceInputObservationResult>;
}

export interface KnowledgeSourceObservationStartupReconcilerDependencies {
  watchPlan: KnowledgeSourceWatchPlan;
  artifactReader: KnowledgeSourceObservationExactReaderPort;
  handoffs: ReadonlyMap<string, KnowledgeSourceObservationRecoveryHandoffPort>;
}

export type KnowledgeSourceObservationStartupFailureCode =
  | "dependency_invalid"
  | "recovery_load_failed"
  | "recovery_work_invalid"
  | "source_authority_missing"
  | "pipeline_fingerprint_changed"
  | "source_revalidation_failed"
  | "source_artifact_invalid"
  | "observation_commit_failed"
  | "observation_settlement_invalid";

const observationStartupErrors = new WeakSet<object>();

function isKnowledgeSourceObservationStartupFailureCode(
  value: unknown
): value is KnowledgeSourceObservationStartupFailureCode {
  return (
    value === "dependency_invalid" ||
    value === "recovery_load_failed" ||
    value === "recovery_work_invalid" ||
    value === "source_authority_missing" ||
    value === "pipeline_fingerprint_changed" ||
    value === "source_revalidation_failed" ||
    value === "source_artifact_invalid" ||
    value === "observation_commit_failed" ||
    value === "observation_settlement_invalid"
  );
}

export class KnowledgeSourceObservationStartupError extends Error {
  readonly code: KnowledgeSourceObservationStartupFailureCode;

  constructor(code: KnowledgeSourceObservationStartupFailureCode) {
    super("Knowledge source observation startup reconciliation failed");
    if (!isKnowledgeSourceObservationStartupFailureCode(code)) {
      throw new TypeError("Invalid knowledge source observation startup failure code");
    }
    this.name = "KnowledgeSourceObservationStartupError";
    this.code = code;
    observationStartupErrors.add(this);
    Object.freeze(this);
  }
}

export function isKnowledgeSourceObservationStartupError(
  value: unknown
): value is KnowledgeSourceObservationStartupError {
  return typeof value === "object" && value !== null && observationStartupErrors.has(value);
}

export interface KnowledgeSourceObservationStartupResult {
  kind: "reconciled";
  replayedBoundCount: number;
  supersededBoundCount: number;
  deferredAllocatedCount: number;
  deferredDriftCount: number;
}

interface CapturedHandoffPort {
  loadRecoveryWork(bundleId: string): Promise<SourceInputObservationRecoveryWork[]>;
  commit(request: BindSourceInputObservationRequest): Promise<CommitSourceInputObservationResult>;
}

interface CapturedDependencies {
  watchPlan: KnowledgeSourceWatchPlan;
  artifactReader: KnowledgeSourceObservationExactReaderPort;
  handoffs: ReadonlyMap<string, CapturedHandoffPort>;
}

interface RecoveryWorkSnapshot {
  kind: "allocated" | "bound";
  bundleId: string;
  sourceId: string;
  inputRevision: number;
  observation?: BoundSourceInputObservation;
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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
  key: string
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

function snapshotDenseArray(value: unknown): readonly unknown[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_RECOVERY_WORK_PER_BUNDLE ||
    Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
  ) {
    return undefined;
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return undefined;
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function isOpaqueIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isInputRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function snapshotAllocation(value: unknown): RecoveryWorkSnapshot | undefined {
  const allocation = snapshotRequiredDataProperties(value, [
    "bundleId",
    "sourceId",
    "captureId",
    "inputRevision",
    "observationToken",
  ]);
  if (
    !allocation ||
    !isOpaqueIdentifier(allocation.bundleId) ||
    !isOpaqueIdentifier(allocation.sourceId) ||
    !isOpaqueIdentifier(allocation.captureId) ||
    !isInputRevision(allocation.inputRevision) ||
    !isOpaqueIdentifier(allocation.observationToken)
  ) {
    return undefined;
  }
  return Object.freeze({
    kind: "allocated",
    bundleId: allocation.bundleId,
    sourceId: allocation.sourceId,
    inputRevision: allocation.inputRevision,
  });
}

function snapshotBoundObservation(value: unknown): RecoveryWorkSnapshot | undefined {
  const observation = snapshotRequiredDataProperties(value, [
    "bundleId",
    "sourceId",
    "captureId",
    "inputRevision",
    "observationToken",
    "sourceContentHash",
    "pipelineFingerprint",
  ]);
  if (
    !observation ||
    !isOpaqueIdentifier(observation.bundleId) ||
    !isOpaqueIdentifier(observation.sourceId) ||
    !isOpaqueIdentifier(observation.captureId) ||
    !isInputRevision(observation.inputRevision) ||
    !isOpaqueIdentifier(observation.observationToken) ||
    typeof observation.sourceContentHash !== "string" ||
    !SHA256_PATTERN.test(observation.sourceContentHash) ||
    typeof observation.pipelineFingerprint !== "string" ||
    !SHA256_PATTERN.test(observation.pipelineFingerprint)
  ) {
    return undefined;
  }
  const detached: BoundSourceInputObservation = Object.freeze({
    bundleId: observation.bundleId,
    sourceId: observation.sourceId,
    captureId: observation.captureId,
    inputRevision: observation.inputRevision,
    observationToken: observation.observationToken,
    sourceContentHash: observation.sourceContentHash,
    pipelineFingerprint: observation.pipelineFingerprint,
  });
  return Object.freeze({
    kind: "bound",
    bundleId: detached.bundleId,
    sourceId: detached.sourceId,
    inputRevision: detached.inputRevision,
    observation: detached,
  });
}

function snapshotRecoveryWork(value: unknown): RecoveryWorkSnapshot | undefined {
  const envelope = snapshotRequiredDataProperties(value, ["kind"]);
  if (!envelope) {
    return undefined;
  }
  if (envelope.kind === "allocated") {
    const payload = snapshotRequiredDataProperties(value, ["allocation"]);
    return payload ? snapshotAllocation(payload.allocation) : undefined;
  }
  if (envelope.kind === "bound") {
    const payload = snapshotRequiredDataProperties(value, ["observation"]);
    return payload ? snapshotBoundObservation(payload.observation) : undefined;
  }
  return undefined;
}

function captureDependencies(
  dependencies: KnowledgeSourceObservationStartupReconcilerDependencies
): CapturedDependencies {
  try {
    const dependencySnapshot = snapshotRequiredDataProperties(dependencies, [
      "watchPlan",
      "artifactReader",
      "handoffs",
    ]);
    if (!dependencySnapshot) {
      throw new KnowledgeSourceObservationStartupError("dependency_invalid");
    }
    KnowledgeSourceWatchPlan.assert(dependencySnapshot.watchPlan);
    const watchPlan = dependencySnapshot.watchPlan;
    const readExpected = snapshotDataMethod(dependencySnapshot.artifactReader, "readExpected");
    if (!readExpected) {
      throw new KnowledgeSourceObservationStartupError("dependency_invalid");
    }

    const suppliedHandoffs = dependencySnapshot.handoffs;
    if (
      (typeof suppliedHandoffs !== "object" || suppliedHandoffs === null) &&
      typeof suppliedHandoffs !== "function"
    ) {
      throw new KnowledgeSourceObservationStartupError("dependency_invalid");
    }
    const getHandoff = snapshotDataMethod(suppliedHandoffs, "get");
    if (!getHandoff) {
      throw new KnowledgeSourceObservationStartupError("dependency_invalid");
    }

    const handoffs = new Map<string, CapturedHandoffPort>();
    for (const authority of watchPlan.getBundleAuthorities()) {
      const candidate = Reflect.apply(getHandoff.method, getHandoff.receiver, [
        authority.bundleId,
      ]) as unknown;
      const loadRecoveryWork = snapshotDataMethod(candidate, "loadRecoveryWork");
      const commit = snapshotDataMethod(candidate, "commit");
      if (!loadRecoveryWork || !commit) {
        throw new KnowledgeSourceObservationStartupError("dependency_invalid");
      }
      handoffs.set(
        authority.bundleId,
        Object.freeze({
          loadRecoveryWork: (bundleId: string) =>
            Reflect.apply(loadRecoveryWork.method, loadRecoveryWork.receiver, [
              bundleId,
            ]) as Promise<SourceInputObservationRecoveryWork[]>,
          commit: (request: BindSourceInputObservationRequest) =>
            Reflect.apply(commit.method, commit.receiver, [
              request,
            ]) as Promise<CommitSourceInputObservationResult>,
        })
      );
    }

    return Object.freeze({
      watchPlan,
      artifactReader: Object.freeze({
        readExpected: (sourcePath: string, expectedContentHash: string, signal?: AbortSignal) =>
          Reflect.apply(readExpected.method, readExpected.receiver, [
            sourcePath,
            expectedContentHash,
            signal,
          ]) as Promise<KnowledgeSourceObservationExpectedArtifact>,
      }),
      handoffs,
    });
  } catch (error) {
    if (isKnowledgeSourceObservationStartupError(error)) {
      throw error;
    }
    throw new KnowledgeSourceObservationStartupError("dependency_invalid");
  }
}

function readErrorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  let owner: object | null = error;
  const visited = new Set<object>();
  while (owner && !visited.has(owner)) {
    visited.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, "name");
    if (descriptor) {
      return "value" in descriptor && typeof descriptor.value === "string"
        ? descriptor.value
        : undefined;
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return undefined;
}

function isSourceDriftError(error: unknown): boolean {
  const name = readErrorName(error);
  return name === "SourceArtifactHashMismatchError" || name === "SourceArtifactUnavailableError";
}

function verifyExpectedArtifact(
  value: unknown,
  sourcePath: string,
  expectedContentHash: string
): "matched" | "drifted" {
  const artifact = snapshotRequiredDataProperties(value, [
    "sourcePath",
    "bytes",
    "sourceContentHash",
  ]);
  if (
    !artifact ||
    typeof artifact.sourcePath !== "string" ||
    !isExactUint8Array(artifact.bytes) ||
    typeof artifact.sourceContentHash !== "string" ||
    !SHA256_PATTERN.test(artifact.sourceContentHash)
  ) {
    throw new KnowledgeSourceObservationStartupError("source_artifact_invalid");
  }
  const bytes = new Uint8Array(artifact.bytes);
  if (createSourceContentHash(bytes) !== artifact.sourceContentHash) {
    throw new KnowledgeSourceObservationStartupError("source_artifact_invalid");
  }
  if (artifact.sourcePath !== sourcePath || artifact.sourceContentHash !== expectedContentHash) {
    return "drifted";
  }
  return "matched";
}

function verifySettlement(
  value: unknown,
  observation: BoundSourceInputObservation
): CommitSourceInputObservationResult {
  const kind = snapshotRequiredDataProperties(value, ["kind"]);
  if (!kind || typeof kind.kind !== "string") {
    throw new KnowledgeSourceObservationStartupError("observation_settlement_invalid");
  }
  if (kind.kind === "committed") {
    const committed = snapshotRequiredDataProperties(value, ["observation", "queueRevision"]);
    const settledObservation = committed
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
      !settledObservation ||
      settledObservation.bundleId !== observation.bundleId ||
      settledObservation.sourceId !== observation.sourceId ||
      settledObservation.captureId !== observation.captureId ||
      settledObservation.inputRevision !== observation.inputRevision ||
      settledObservation.observationToken !== observation.observationToken ||
      settledObservation.sourceContentHash !== observation.sourceContentHash ||
      settledObservation.pipelineFingerprint !== observation.pipelineFingerprint ||
      !Number.isSafeInteger(committed.queueRevision) ||
      (committed.queueRevision as number) < 1
    ) {
      throw new KnowledgeSourceObservationStartupError("observation_settlement_invalid");
    }
    return Object.freeze({
      kind: "committed",
      observation,
      queueRevision: committed.queueRevision as number,
    });
  }

  const superseded = snapshotRequiredDataProperties(value, [
    "bundleId",
    "sourceId",
    "captureId",
    "inputRevision",
    "supersededByInputRevision",
  ]);
  if (
    kind.kind !== "superseded" ||
    !superseded ||
    superseded.bundleId !== observation.bundleId ||
    superseded.sourceId !== observation.sourceId ||
    superseded.captureId !== observation.captureId ||
    superseded.inputRevision !== observation.inputRevision ||
    !Number.isSafeInteger(superseded.supersededByInputRevision) ||
    (superseded.supersededByInputRevision as number) <= observation.inputRevision
  ) {
    throw new KnowledgeSourceObservationStartupError("observation_settlement_invalid");
  }
  return Object.freeze({
    kind: "superseded",
    bundleId: observation.bundleId,
    sourceId: observation.sourceId,
    captureId: observation.captureId,
    inputRevision: observation.inputRevision,
    supersededByInputRevision: superseded.supersededByInputRevision as number,
  });
}

function createRecoveryIdentityKey(work: RecoveryWorkSnapshot): string {
  return `${work.bundleId.length}:${work.bundleId}${work.sourceId.length}:${work.sourceId}:${work.inputRevision}`;
}

export class KnowledgeSourceObservationStartupReconciler {
  private readonly dependencies: CapturedDependencies;
  private generation = 0;
  private closed = false;
  private running = false;
  private operationController?: AbortController;

  constructor(dependencies: KnowledgeSourceObservationStartupReconcilerDependencies) {
    this.dependencies = captureDependencies(dependencies);
  }

  async reconcile(signal: AbortSignal): Promise<KnowledgeSourceObservationStartupResult> {
    if (this.closed || this.running || signal.aborted) {
      throw createAbortError();
    }
    this.running = true;
    this.generation += 1;
    const generation = this.generation;
    const controller = new AbortController();
    this.operationController = controller;
    const abortOperation = (): void => controller.abort();
    signal.addEventListener("abort", abortOperation, { once: true });

    try {
      this.assertCurrent(generation, signal);
      const work = await this.loadRecoveryWork(generation, signal);
      let replayedBoundCount = 0;
      let supersededBoundCount = 0;
      let deferredAllocatedCount = 0;
      let deferredDriftCount = 0;

      for (const item of work) {
        this.assertCurrent(generation, signal);
        const source = this.dependencies.watchPlan.getSource(item.bundleId, item.sourceId);
        if (!source) {
          throw new KnowledgeSourceObservationStartupError("source_authority_missing");
        }
        if (item.kind === "allocated") {
          deferredAllocatedCount += 1;
          continue;
        }
        const observation = item.observation;
        if (!observation) {
          throw new KnowledgeSourceObservationStartupError("recovery_work_invalid");
        }
        if (observation.pipelineFingerprint !== source.pipelineFingerprint) {
          throw new KnowledgeSourceObservationStartupError("pipeline_fingerprint_changed");
        }

        const revalidation = await this.revalidate(
          source.sourcePath,
          observation.sourceContentHash,
          generation,
          signal,
          controller.signal
        );
        if (revalidation === "drifted") {
          deferredDriftCount += 1;
          continue;
        }

        const settlement = await this.commit(observation, generation, signal);
        if (settlement.kind === "committed") {
          replayedBoundCount += 1;
        } else {
          supersededBoundCount += 1;
        }
      }

      this.assertCurrent(generation, signal);
      return Object.freeze({
        kind: "reconciled",
        replayedBoundCount,
        supersededBoundCount,
        deferredAllocatedCount,
        deferredDriftCount,
      });
    } finally {
      signal.removeEventListener("abort", abortOperation);
      if (this.operationController === controller) {
        this.operationController = undefined;
      }
      this.running = false;
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.generation += 1;
    this.operationController?.abort();
  }

  private async loadRecoveryWork(
    generation: number,
    signal: AbortSignal
  ): Promise<readonly RecoveryWorkSnapshot[]> {
    const work: RecoveryWorkSnapshot[] = [];
    const identities = new Set<string>();
    for (const authority of this.dependencies.watchPlan.getBundleAuthorities()) {
      this.assertCurrent(generation, signal);
      const handoff = this.dependencies.handoffs.get(authority.bundleId);
      if (!handoff) {
        throw new KnowledgeSourceObservationStartupError("dependency_invalid");
      }
      let loaded: unknown;
      try {
        loaded = await handoff.loadRecoveryWork(authority.bundleId);
      } catch {
        this.assertCurrent(generation, signal);
        throw new KnowledgeSourceObservationStartupError("recovery_load_failed");
      }
      this.assertCurrent(generation, signal);
      const items = snapshotDenseArray(loaded);
      if (!items) {
        throw new KnowledgeSourceObservationStartupError("recovery_work_invalid");
      }
      for (const value of items) {
        const item = snapshotRecoveryWork(value);
        if (!item || item.bundleId !== authority.bundleId) {
          throw new KnowledgeSourceObservationStartupError("recovery_work_invalid");
        }
        const identity = createRecoveryIdentityKey(item);
        if (identities.has(identity)) {
          throw new KnowledgeSourceObservationStartupError("recovery_work_invalid");
        }
        identities.add(identity);
        work.push(item);
      }
    }
    work.sort(
      (left, right) =>
        compareText(left.bundleId, right.bundleId) ||
        compareText(left.sourceId, right.sourceId) ||
        left.inputRevision - right.inputRevision
    );
    return Object.freeze(work);
  }

  private async revalidate(
    sourcePath: string,
    expectedContentHash: string,
    generation: number,
    signal: AbortSignal,
    operationSignal: AbortSignal
  ): Promise<"matched" | "drifted"> {
    let artifact: unknown;
    try {
      artifact = await this.dependencies.artifactReader.readExpected(
        sourcePath,
        expectedContentHash,
        operationSignal
      );
    } catch (error) {
      this.assertCurrent(generation, signal);
      if (isSourceDriftError(error)) {
        return "drifted";
      }
      throw new KnowledgeSourceObservationStartupError("source_revalidation_failed");
    }
    this.assertCurrent(generation, signal);
    return verifyExpectedArtifact(artifact, sourcePath, expectedContentHash);
  }

  private async commit(
    observation: BoundSourceInputObservation,
    generation: number,
    signal: AbortSignal
  ): Promise<CommitSourceInputObservationResult> {
    const handoff = this.dependencies.handoffs.get(observation.bundleId);
    if (!handoff) {
      throw new KnowledgeSourceObservationStartupError("dependency_invalid");
    }
    const request: BindSourceInputObservationRequest = Object.freeze({
      observationToken: observation.observationToken,
      sourceContentHash: observation.sourceContentHash,
      pipelineFingerprint: observation.pipelineFingerprint,
    });
    for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
      this.assertCurrent(generation, signal);
      try {
        const settlement = await handoff.commit(request);
        this.assertCurrent(generation, signal);
        return verifySettlement(settlement, observation);
      } catch (error) {
        this.assertCurrent(generation, signal);
        if (isKnowledgeSourceObservationStartupError(error)) {
          throw error;
        }
        if (attempt + 1 === COMMIT_ATTEMPTS) {
          throw new KnowledgeSourceObservationStartupError("observation_commit_failed");
        }
      }
    }
    throw new KnowledgeSourceObservationStartupError("observation_commit_failed");
  }

  private assertCurrent(generation: number, signal: AbortSignal): void {
    if (this.closed || this.generation !== generation || signal.aborted) {
      throw createAbortError();
    }
  }
}

Object.freeze(KnowledgeSourceObservationStartupReconciler.prototype);
Object.freeze(KnowledgeSourceObservationStartupReconciler);
