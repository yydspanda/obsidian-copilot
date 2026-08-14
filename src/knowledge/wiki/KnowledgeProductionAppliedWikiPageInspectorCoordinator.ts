import type { CompilerTargetRequest } from "@/knowledge/compiler/CompilerModelPort";
import type {
  ObsidianKnowledgeCompilerTargetVisitPort,
  ObsidianKnowledgeCompilerTargetVisitor,
} from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import type { KnowledgeOutputObservationReaderPort } from "@/knowledge/ingest/ObsidianKnowledgeOutputObservationReader";
import { isKnowledgeAbortError } from "@/knowledge/errors/abortError";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import { validateKnowledgeBundleConfig } from "@/knowledge/model/validation";
import { isPathWithinRoot, parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type {
  ObsidianKnowledgeCitationNavigationRequest,
  ObsidianKnowledgeCitationNavigationResult,
} from "@/knowledge/query/ObsidianKnowledgeCitationNavigator";
import type { KnowledgeAppliedProvenanceReadPort } from "@/knowledge/query/KnowledgeAppliedWikiSnapshotReader";
import type { KnowledgeRuntimeAppliedProvenanceSnapshot } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  getKnowledgeAppliedWikiPageInspectorErrorCode,
  KnowledgeAppliedWikiPageInspectorError,
  snapshotKnowledgeAppliedWikiPageInspectionRequest,
  type KnowledgeAppliedWikiEvidenceOpenResult,
  type KnowledgeAppliedWikiPageInspectionRequest,
  type KnowledgeAppliedWikiPageInspectionSession,
  type KnowledgeAppliedWikiPageInspectorPort,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import {
  KnowledgeAppliedWikiPageInspectionProjector,
  snapshotKnowledgeAppliedWikiPageProjectionAuthority,
  type KnowledgeAppliedWikiEvidenceAuthority,
  type KnowledgeAppliedWikiPageProjectionAuthority,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageProjector";
import {
  KNOWLEDGE_APPLIED_WIKI_PATH_INDEX_MAX_ROWS,
  type KnowledgeAppliedWikiPathIndexRow,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPathIndex";
import { sha256Bytes } from "@/utils/hash";

const DEFAULT_MAX_CONSISTENCY_ATTEMPTS = 3;
const MAX_FILE_BYTES = 2_000_000;
const MAX_FILE_CHARACTERS = 2_000_000;
const MAX_RUNTIME_PAGES = 10_000;
const MAX_BUNDLES = 256;
const MAX_BUNDLE_ID_CHARACTERS = 256;
const MAX_CONFIG_PATH_CHARACTERS = 1_024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STALE_RESULT = Object.freeze({ kind: "stale" as const });
const UNSUPPORTED_RESULT = Object.freeze({ kind: "unsupported" as const });
const UNAVAILABLE_RESULT = Object.freeze({ kind: "unavailable" as const });

/** One validated Bundle and its bounded read-before-content target visitor. */
export interface KnowledgeProductionAppliedWikiBundleBinding {
  readonly bundle: KnowledgeBundleConfig;
  readonly targetVisitor: ObsidianKnowledgeCompilerTargetVisitPort;
}

/** The only workspace side effect accepted by the inspector coordinator. */
export interface KnowledgeAppliedWikiEvidenceNavigationPort {
  /** Opens one exact, already re-proved Source citation. */
  navigate(
    request: ObsidianKnowledgeCitationNavigationRequest,
    signal?: AbortSignal
  ): Promise<ObsidianKnowledgeCitationNavigationResult>;
}

/** Least-authority advisory row listing used to populate the synchronous path index. */
export interface KnowledgeAppliedWikiPathIndexRowListPort {
  /** Lists bounded current Manifest page identities without reading Vault content. */
  listAppliedWikiPathIndexRows(
    signal: AbortSignal
  ): Promise<readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]>;
}

/** Read-only dependencies captured by one released production generation. */
export interface KnowledgeProductionAppliedWikiPageInspectorCoordinatorInput {
  readonly runtime: KnowledgeAppliedProvenanceReadPort;
  readonly bundles: readonly Readonly<KnowledgeProductionAppliedWikiBundleBinding>[];
  readonly navigator: KnowledgeAppliedWikiEvidenceNavigationPort;
  readonly assertCurrent: () => void;
  readonly maxConsistencyAttempts?: number;
}

interface CapturedBundleBinding {
  readonly bundle: Readonly<KnowledgeBundleConfig>;
  readonly observeOne: KnowledgeOutputObservationReaderPort["observe"];
}

interface CoordinatorState {
  readonly runtime: KnowledgeAppliedProvenanceReadPort;
  readonly bundles: readonly Readonly<CapturedBundleBinding>[];
  readonly navigator: KnowledgeAppliedWikiEvidenceNavigationPort;
  readonly assertCurrent: () => void;
  readonly maxConsistencyAttempts: number;
  readonly projector: KnowledgeAppliedWikiPageInspectionProjector;
  readonly sessions: WeakMap<object, Readonly<CoordinatorSessionBinding>>;
}

interface CoordinatorSessionBinding {
  readonly bundle: Readonly<CapturedBundleBinding>;
  readonly projectorSession: Readonly<KnowledgeAppliedWikiPageInspectionSession>;
  readonly authority: Readonly<KnowledgeAppliedWikiPageProjectionAuthority>;
}

interface StablePageRead {
  readonly authority: Readonly<KnowledgeAppliedWikiPageProjectionAuthority>;
  readonly state: "applied" | "drifted";
}

class ConsistencyRetry extends Error {}
class PageNotApplied extends Error {}
class PageDrifted extends Error {}

const coordinatorStates = new WeakMap<object, CoordinatorState>();

/** Reads one own enumerable data property without invoking an accessor. */
function readDataProperty(value: unknown, key: string): unknown {
  try {
    if (typeof value !== "object" || value === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor && descriptor.enumerable
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Creates the platform-standard value-free cancellation category. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Stops work before and after every asynchronous authority boundary. */
function assertInvocation(state: CoordinatorState, signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError();
  state.assertCurrent();
  if (signal.aborted) throw createAbortError();
}

/** Reads one exact own enumerable data record without invoking accessors. */
function readExactRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string") ||
      !expectedKeys.every((key) => keys.includes(key))
    ) {
      return undefined;
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Snapshots one dense bounded array through data descriptors only. */
function snapshotDenseArray(value: unknown, maxLength: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maxLength ||
      Reflect.ownKeys(value).length !== length.value + 1
    ) {
      return undefined;
    }
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Captures one data method across a bounded acyclic prototype chain. */
function captureMethod(
  value: object,
  methodName: string
): ((...args: unknown[]) => unknown) | undefined {
  try {
    let owner: object | null = value;
    const visited = new Set<object>();
    while (owner !== null && visited.size < 64) {
      if (visited.has(owner)) return undefined;
      visited.add(owner);
      const descriptor = Object.getOwnPropertyDescriptor(owner, methodName);
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "function"
          ? (descriptor.value as (...args: unknown[]) => unknown)
          : undefined;
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Captures one Runtime read capability with its exact receiver. */
function captureRuntime(
  value: KnowledgeAppliedProvenanceReadPort
): KnowledgeAppliedProvenanceReadPort {
  if (typeof value !== "object" || value === null) throw createAbortError();
  const method = captureMethod(value, "readAppliedProvenance");
  if (!method) throw createAbortError();
  return Object.freeze({
    readAppliedProvenance: (bundleId: string) =>
      Promise.resolve(
        Reflect.apply(method, value, [
          bundleId,
        ]) as Promise<KnowledgeRuntimeAppliedProvenanceSnapshot>
      ),
  });
}

/** Captures one navigator capability with its exact receiver. */
function captureNavigator(
  value: KnowledgeAppliedWikiEvidenceNavigationPort
): KnowledgeAppliedWikiEvidenceNavigationPort {
  if (typeof value !== "object" || value === null) throw createAbortError();
  const method = captureMethod(value, "navigate");
  if (!method) throw createAbortError();
  return Object.freeze({
    navigate: (request: ObsidianKnowledgeCitationNavigationRequest, signal?: AbortSignal) =>
      Promise.resolve(
        Reflect.apply(method, value, [
          request,
          signal,
        ]) as Promise<ObsidianKnowledgeCitationNavigationResult>
      ),
  });
}

/** Captures one bounded visitor as a hash-only single-page observation. */
function captureObserver(
  value: ObsidianKnowledgeCompilerTargetVisitPort
): KnowledgeOutputObservationReaderPort["observe"] {
  if (typeof value !== "object" || value === null) throw createAbortError();
  const visit = captureMethod(value, "visit");
  if (!visit) throw createAbortError();
  return async (outputs, signal) => {
    const outputValues = snapshotDenseArray(outputs, 1);
    const output =
      outputValues?.length === 1
        ? readExactRecord(outputValues[0], ["path", "contentHash"])
        : undefined;
    const parsedOutputPath =
      typeof output?.path === "string" ? parseVaultPath(output.path) : undefined;
    if (
      !output ||
      !parsedOutputPath?.ok ||
      parsedOutputPath.path !== output.path ||
      typeof output.contentHash !== "string" ||
      !SHA256_PATTERN.test(output.contentHash)
    ) {
      throw new ConsistencyRetry();
    }
    const request = Object.freeze({
      targetId: "wiki-inspector-page",
      path: parsedOutputPath.path,
      intent: "write" as const,
      access: "authorized" as const,
    });
    let projected:
      | Readonly<{ path: string; kind: "file"; contentHash: string }>
      | Readonly<{ path: string; kind: "missing" | "directory" }>
      | undefined;
    let callbackActive = false;
    let visitActive = true;
    const visitor: ObsidianKnowledgeCompilerTargetVisitor = async (observation, fileByteSize) => {
      if (!visitActive || callbackActive || projected !== undefined) throw new ConsistencyRetry();
      callbackActive = true;
      try {
        if (signal.aborted) throw createAbortError();
        const result = projectObservation(observation, fileByteSize, request);
        projected = result;
        if (signal.aborted) throw createAbortError();
      } finally {
        callbackActive = false;
      }
    };
    try {
      await Promise.resolve(
        Reflect.apply(visit, value, [
          Object.freeze([request]),
          signal,
          Object.freeze({ maxFileBytes: MAX_FILE_BYTES }),
          visitor,
        ])
      );
    } finally {
      visitActive = false;
    }
    if (callbackActive || !projected) throw new ConsistencyRetry();
    return Object.freeze([projected]);
  };
}

/** Strictly projects one single-file visitor observation to path/hash only. */
function projectObservation(
  value: unknown,
  fileByteSize: number | undefined,
  request: Readonly<CompilerTargetRequest>
):
  | Readonly<{ path: string; kind: "file"; contentHash: string }>
  | Readonly<{ path: string; kind: "missing" | "directory" }> {
  const kind =
    typeof value === "object" && value !== null
      ? Object.getOwnPropertyDescriptor(value, "kind")
      : undefined;
  if (!kind || !("value" in kind) || !kind.enumerable) throw new ConsistencyRetry();
  if (kind.value === "missing") {
    const record = readExactRecord(value, ["targetId", "kind", "windowsPathKey"]);
    if (
      !record ||
      record.targetId !== request.targetId ||
      record.windowsPathKey !== toWindowsPathKey(request.path) ||
      fileByteSize !== undefined
    ) {
      throw new ConsistencyRetry();
    }
    return Object.freeze({ path: request.path, kind: "missing" as const });
  }
  if (kind.value === "directory") {
    const record = readExactRecord(value, ["targetId", "kind", "path"]);
    if (
      !record ||
      record.targetId !== request.targetId ||
      record.path !== request.path ||
      fileByteSize !== undefined
    ) {
      throw new ConsistencyRetry();
    }
    return Object.freeze({ path: request.path, kind: "directory" as const });
  }
  const record = readExactRecord(value, ["targetId", "kind", "path", "content"]);
  if (
    !record ||
    record.kind !== "file" ||
    record.targetId !== request.targetId ||
    record.path !== request.path ||
    typeof record.content !== "string" ||
    record.content.length > MAX_FILE_CHARACTERS ||
    !Number.isSafeInteger(fileByteSize) ||
    (fileByteSize as number) < 0 ||
    (fileByteSize as number) > MAX_FILE_BYTES
  ) {
    throw new ConsistencyRetry();
  }
  const bytes = new TextEncoder().encode(record.content);
  if (bytes.byteLength !== fileByteSize) throw new ConsistencyRetry();
  return Object.freeze({
    path: request.path,
    kind: "file" as const,
    contentHash: sha256Bytes(bytes),
  });
}

/** Reports whether two configured path boundaries overlap under Windows semantics. */
function pathsOverlap(left: string, right: string): boolean {
  return isPathWithinRoot(left, right) || isPathWithinRoot(right, left);
}

/** Captures and cross-validates the complete Bundle/visitor dependency set. */
function snapshotBundleBindings(value: unknown): readonly Readonly<CapturedBundleBinding>[] {
  const raw = snapshotDenseArray(value, MAX_BUNDLES);
  if (!raw || raw.length === 0) throw createAbortError();
  const bindings = raw.map((item) => {
    const record = readExactRecord(item, ["bundle", "targetVisitor"]);
    const bundleRecord = record
      ? readExactRecord(record.bundle, [
          "version",
          "id",
          "sourceRoots",
          "wikiRoot",
          "schemaRef",
          "reviewMode",
        ])
      : undefined;
    const sourceRoots = bundleRecord
      ? snapshotDenseArray(bundleRecord.sourceRoots, 256)
      : undefined;
    if (
      !record ||
      !sourceRoots ||
      typeof bundleRecord?.id !== "string" ||
      bundleRecord.id.length > MAX_BUNDLE_ID_CHARACTERS ||
      typeof bundleRecord.wikiRoot !== "string" ||
      bundleRecord.wikiRoot.length > MAX_CONFIG_PATH_CHARACTERS ||
      typeof bundleRecord.schemaRef !== "string" ||
      bundleRecord.schemaRef.length > MAX_CONFIG_PATH_CHARACTERS ||
      sourceRoots.some(
        (root) => typeof root !== "string" || root.length > MAX_CONFIG_PATH_CHARACTERS
      )
    ) {
      throw createAbortError();
    }
    const snapshot = Object.freeze({
      version: bundleRecord?.version,
      id: bundleRecord?.id,
      sourceRoots: Object.freeze([...sourceRoots]) as unknown as string[],
      wikiRoot: bundleRecord?.wikiRoot,
      schemaRef: bundleRecord?.schemaRef,
      reviewMode: bundleRecord?.reviewMode,
    }) as KnowledgeBundleConfig;
    if (!validateKnowledgeBundleConfig(snapshot).valid) throw createAbortError();
    return Object.freeze({
      bundle: snapshot,
      observeOne: captureObserver(record.targetVisitor as ObsidianKnowledgeCompilerTargetVisitPort),
    });
  });
  const bundleIds = new Set<string>();
  for (let leftIndex = 0; leftIndex < bindings.length; leftIndex += 1) {
    const left = bindings[leftIndex].bundle;
    if (bundleIds.has(left.id)) throw createAbortError();
    bundleIds.add(left.id);
    for (let rightIndex = leftIndex + 1; rightIndex < bindings.length; rightIndex += 1) {
      const right = bindings[rightIndex].bundle;
      const conflict =
        pathsOverlap(left.wikiRoot, right.wikiRoot) ||
        left.sourceRoots.some((root) => pathsOverlap(root, right.wikiRoot)) ||
        right.sourceRoots.some((root) => pathsOverlap(root, left.wikiRoot)) ||
        isPathWithinRoot(left.schemaRef, right.wikiRoot) ||
        isPathWithinRoot(right.schemaRef, left.wikiRoot);
      if (conflict) {
        throw createAbortError();
      }
    }
  }
  return Object.freeze(bindings);
}

/** Strictly captures top-level dependencies before invoking any capability. */
function snapshotCoordinatorInput(
  value: unknown
): Readonly<KnowledgeProductionAppliedWikiPageInspectorCoordinatorInput> {
  const record =
    readExactRecord(value, ["runtime", "bundles", "navigator", "assertCurrent"]) ??
    readExactRecord(value, [
      "runtime",
      "bundles",
      "navigator",
      "assertCurrent",
      "maxConsistencyAttempts",
    ]);
  if (!record || typeof record.assertCurrent !== "function") throw createAbortError();
  return Object.freeze({
    runtime: record.runtime as KnowledgeAppliedProvenanceReadPort,
    bundles: record.bundles as readonly Readonly<KnowledgeProductionAppliedWikiBundleBinding>[],
    navigator: record.navigator as KnowledgeAppliedWikiEvidenceNavigationPort,
    assertCurrent: record.assertCurrent as () => void,
    ...(record.maxConsistencyAttempts === undefined
      ? {}
      : { maxConsistencyAttempts: record.maxConsistencyAttempts as number }),
  });
}

/** Returns hidden state only for an authentic frozen coordinator. */
function requireCoordinatorState(value: unknown): CoordinatorState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !==
      KnowledgeProductionAppliedWikiPageInspectorCoordinator.prototype
  ) {
    throw createAbortError();
  }
  const state = coordinatorStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Strictly snapshots a Runtime provenance envelope and all page authorities. */
function snapshotRuntimeProjection(
  bundle: Readonly<KnowledgeBundleConfig>,
  value: unknown,
  selectedPagePath: string
): Readonly<KnowledgeAppliedWikiPageProjectionAuthority> {
  const record = readExactRecord(value, [
    "bundleId",
    "runtimeRevision",
    "manifestRevision",
    "pages",
  ]);
  const pages = record ? snapshotDenseArray(record.pages, MAX_RUNTIME_PAGES) : undefined;
  if (
    !record ||
    record.bundleId !== bundle.id ||
    !Number.isSafeInteger(record.runtimeRevision) ||
    (record.runtimeRevision as number) < 0 ||
    !Number.isSafeInteger(record.manifestRevision) ||
    (record.manifestRevision as number) < 0 ||
    !pages
  ) {
    throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
  }
  const pathKeys = new Set<string>();
  const selectedKey = toWindowsPathKey(selectedPagePath);
  let selected: Readonly<KnowledgeAppliedWikiPageProjectionAuthority> | undefined;
  for (const page of pages) {
    const pagePath = readDataProperty(page, "path");
    const windowsPathKey = readDataProperty(page, "windowsPathKey");
    const parsed =
      typeof pagePath === "string" && pagePath.length <= 1_024
        ? parseVaultPath(pagePath)
        : undefined;
    if (
      !parsed?.ok ||
      parsed.path !== pagePath ||
      typeof windowsPathKey !== "string" ||
      windowsPathKey.length > 1_024 ||
      windowsPathKey !== toWindowsPathKey(parsed.path) ||
      !isPathWithinRoot(parsed.path, bundle.wikiRoot) ||
      pathKeys.has(windowsPathKey)
    ) {
      throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
    }
    pathKeys.add(windowsPathKey);
    if (windowsPathKey === selectedKey) {
      if (parsed.path !== selectedPagePath || selected) {
        throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
      }
      selected = snapshotKnowledgeAppliedWikiPageProjectionAuthority({
        bundleId: bundle.id,
        runtimeRevision: record.runtimeRevision,
        manifestRevision: record.manifestRevision,
        page,
      });
      if (
        selected.page.sources.some(
          (source) => !bundle.sourceRoots.some((root) => isPathWithinRoot(source.sourcePath, root))
        )
      ) {
        throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
      }
    }
  }
  if (!selected) throw new PageNotApplied();
  return selected;
}

/** Strictly projects only page identity rows for advisory menu discovery. */
function snapshotRuntimePathRows(
  bundle: Readonly<KnowledgeBundleConfig>,
  value: unknown,
  remainingRows: number
): readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[] {
  const record = readExactRecord(value, [
    "bundleId",
    "runtimeRevision",
    "manifestRevision",
    "pages",
  ]);
  const pages = record ? snapshotDenseArray(record.pages, remainingRows) : undefined;
  if (
    !record ||
    record.bundleId !== bundle.id ||
    !Number.isSafeInteger(record.runtimeRevision) ||
    (record.runtimeRevision as number) < 0 ||
    !Number.isSafeInteger(record.manifestRevision) ||
    (record.manifestRevision as number) < 0 ||
    !pages
  ) {
    throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
  }
  const seenKeys = new Set<string>();
  return Object.freeze(
    pages.map((page) => {
      const path = readDataProperty(page, "path");
      const windowsPathKey = readDataProperty(page, "windowsPathKey");
      const parsed =
        typeof path === "string" && path.length <= 1_024 ? parseVaultPath(path) : undefined;
      if (
        !parsed?.ok ||
        parsed.path !== path ||
        typeof windowsPathKey !== "string" ||
        windowsPathKey.length > 1_024 ||
        windowsPathKey !== toWindowsPathKey(parsed.path) ||
        !isPathWithinRoot(parsed.path, bundle.wikiRoot) ||
        seenKeys.has(windowsPathKey)
      ) {
        throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
      }
      seenKeys.add(windowsPathKey);
      return Object.freeze({ bundleId: bundle.id, pagePath: parsed.path });
    })
  );
}

/** Creates a deterministic canonical identity for exact page/source/citation authority. */
function createAuthorityIdentity(authority: KnowledgeAppliedWikiPageProjectionAuthority): string {
  return JSON.stringify({
    bundleId: authority.bundleId,
    page: authority.page,
  });
}

/** Reads one stable current page through a bounded Runtime/Vault/Runtime sandwich. */
async function readStablePage(
  state: CoordinatorState,
  binding: Readonly<CapturedBundleBinding>,
  pagePath: string,
  signal: AbortSignal
): Promise<Readonly<StablePageRead>> {
  for (let attempt = 0; attempt < state.maxConsistencyAttempts; attempt += 1) {
    try {
      assertInvocation(state, signal);
      const before = snapshotRuntimeProjection(
        binding.bundle,
        await state.runtime.readAppliedProvenance(binding.bundle.id),
        pagePath
      );
      assertInvocation(state, signal);
      const observations = await binding.observeOne(
        Object.freeze([{ path: before.page.path, contentHash: before.page.contentHash }]),
        signal
      );
      assertInvocation(state, signal);
      let after: Readonly<KnowledgeAppliedWikiPageProjectionAuthority>;
      try {
        after = snapshotRuntimeProjection(
          binding.bundle,
          await state.runtime.readAppliedProvenance(binding.bundle.id),
          pagePath
        );
      } catch (error) {
        if (error instanceof PageNotApplied) throw new ConsistencyRetry();
        throw error;
      }
      assertInvocation(state, signal);
      if (
        before.runtimeRevision !== after.runtimeRevision ||
        before.manifestRevision !== after.manifestRevision ||
        createAuthorityIdentity(before) !== createAuthorityIdentity(after)
      ) {
        throw new ConsistencyRetry();
      }
      const observation = observations[0];
      if (!observation || observation.path !== pagePath || observation.kind !== "file") {
        throw new PageDrifted();
      }
      return Object.freeze({
        authority: after,
        state: observation.contentHash === after.page.contentHash ? "applied" : "drifted",
      });
    } catch (error) {
      if (signal.aborted || isKnowledgeAbortError(error)) throw createAbortError();
      if (error instanceof PageNotApplied || error instanceof PageDrifted) throw error;
      if (error instanceof ConsistencyRetry) continue;
      if (getKnowledgeAppliedWikiPageInspectorErrorCode(error)) throw error;
      throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
    }
  }
  throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
}

/** Selects the unique Bundle whose configured Wiki root owns a canonical page path. */
function selectBundle(state: CoordinatorState, pagePath: string): Readonly<CapturedBundleBinding> {
  const matches = state.bundles.filter((binding) =>
    isPathWithinRoot(pagePath, binding.bundle.wikiRoot)
  );
  if (matches.length === 0) throw new PageNotApplied();
  if (matches.length !== 1) throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
  return matches[0];
}

/** Finds one fresh exact evidence authority equivalent to an original session binding. */
function findFreshEvidence(
  projector: KnowledgeAppliedWikiPageInspectionProjector,
  session: Readonly<KnowledgeAppliedWikiPageInspectionSession>,
  original: Readonly<KnowledgeAppliedWikiEvidenceAuthority>
): Readonly<KnowledgeAppliedWikiEvidenceAuthority> | undefined {
  const visible = session.sources.flatMap((source) => source.evidence);
  for (const evidence of visible) {
    const candidate = projector.resolveEvidence(session, evidence.evidenceRef);
    if (
      candidate &&
      candidate.sourceId === original.sourceId &&
      candidate.sourcePath === original.sourcePath &&
      candidate.sourceContentHash === original.sourceContentHash &&
      candidate.pipelineFingerprint === original.pipelineFingerprint &&
      candidate.inputRevision === original.inputRevision &&
      candidate.changeSetId === original.changeSetId &&
      candidate.changeSetDigest === original.changeSetDigest &&
      candidate.acceptedAt === original.acceptedAt &&
      JSON.stringify(candidate.citation) === JSON.stringify(original.citation)
    ) {
      return candidate;
    }
  }
  return undefined;
}

/** Maps an exact navigator result to the value-free inspector result. */
function mapNavigationResult(value: unknown): Readonly<KnowledgeAppliedWikiEvidenceOpenResult> {
  const record = readExactRecord(value, ["status"]);
  switch (record?.status) {
    case "opened":
      return Object.freeze({ kind: "opened" as const });
    case "stale":
      return STALE_RESULT;
    case "unsupported":
      return UNSUPPORTED_RESULT;
    case "unavailable":
    default:
      return UNAVAILABLE_RESULT;
  }
}

/** Reports whether the exact source suffix supports one locator contract. */
function sourceSupportsLocator(sourcePath: string, kind: string): boolean {
  const lowerPath = sourcePath.toLowerCase();
  if (lowerPath.endsWith(".pdf")) return kind === "pdf_page";
  if (lowerPath.endsWith(".md")) return kind !== "pdf_page";
  return false;
}

/**
 * Read-only production inspector for one exact current applied Wiki page.
 *
 * Runtime, bounded Vault reads, and actionable citation material never cross
 * this port. The navigator is the coordinator's only side-effect capability.
 */
export class KnowledgeProductionAppliedWikiPageInspectorCoordinator
  implements KnowledgeAppliedWikiPageInspectorPort, KnowledgeAppliedWikiPathIndexRowListPort
{
  /** Captures one exact Runtime, Bundle/visitor set, navigator, and generation assertion. */
  constructor(input: KnowledgeProductionAppliedWikiPageInspectorCoordinatorInput) {
    const captured = snapshotCoordinatorInput(input);
    const attempts = captured.maxConsistencyAttempts ?? DEFAULT_MAX_CONSISTENCY_ATTEMPTS;
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10) throw createAbortError();
    coordinatorStates.set(this, {
      runtime: captureRuntime(captured.runtime),
      bundles: snapshotBundleBindings(captured.bundles),
      navigator: captureNavigator(captured.navigator),
      assertCurrent: captured.assertCurrent,
      maxConsistencyAttempts: attempts,
      projector: new KnowledgeAppliedWikiPageInspectionProjector(),
      sessions: new WeakMap(),
    });
    Object.freeze(this);
  }

  /** Re-proves one exact current applied page and returns a frozen opaque session. */
  async inspectPage(
    requestValue: Readonly<KnowledgeAppliedWikiPageInspectionRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeAppliedWikiPageInspectionSession>> {
    const state = requireCoordinatorState(this);
    let request: Readonly<KnowledgeAppliedWikiPageInspectionRequest>;
    try {
      request = snapshotKnowledgeAppliedWikiPageInspectionRequest(requestValue);
      assertInvocation(state, signal);
      const bundle = selectBundle(state, request.pagePath);
      const stable = await readStablePage(state, bundle, request.pagePath, signal);
      if (stable.state === "drifted") {
        throw new KnowledgeAppliedWikiPageInspectorError("drifted");
      }
      const projectorSession = state.projector.project(stable.authority);
      state.sessions.set(
        projectorSession,
        Object.freeze({ bundle, projectorSession, authority: stable.authority })
      );
      return projectorSession;
    } catch (error) {
      if (signal.aborted || isKnowledgeAbortError(error)) throw createAbortError();
      if (error instanceof PageNotApplied) {
        throw new KnowledgeAppliedWikiPageInspectorError("not_applied");
      }
      if (error instanceof PageDrifted) {
        throw new KnowledgeAppliedWikiPageInspectorError("drifted");
      }
      const code = getKnowledgeAppliedWikiPageInspectorErrorCode(error);
      throw new KnowledgeAppliedWikiPageInspectorError(code ?? "unavailable");
    }
  }

  /** Freshly re-proves an authentic session/evidence identity before navigation. */
  async openEvidence(
    session: Readonly<KnowledgeAppliedWikiPageInspectionSession>,
    evidenceRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeAppliedWikiEvidenceOpenResult>> {
    const state = requireCoordinatorState(this);
    const binding =
      typeof session === "object" && session !== null ? state.sessions.get(session) : undefined;
    const original = binding
      ? state.projector.resolveEvidence(binding.projectorSession, evidenceRef)
      : undefined;
    if (!binding || !original) return STALE_RESULT;
    try {
      assertInvocation(state, signal);
      const stable = await readStablePage(
        state,
        binding.bundle,
        binding.authority.page.path,
        signal
      );
      if (
        stable.state !== "applied" ||
        createAuthorityIdentity(stable.authority) !== createAuthorityIdentity(binding.authority)
      ) {
        return STALE_RESULT;
      }
      const freshSession = state.projector.project(stable.authority);
      const fresh = findFreshEvidence(state.projector, freshSession, original);
      if (!fresh) return STALE_RESULT;
      if (
        !binding.bundle.bundle.sourceRoots.some((root) => isPathWithinRoot(fresh.sourcePath, root))
      ) {
        return UNAVAILABLE_RESULT;
      }
      if (!sourceSupportsLocator(fresh.sourcePath, fresh.citation.locator.kind)) {
        return UNSUPPORTED_RESULT;
      }
      const result = await state.navigator.navigate(
        Object.freeze({ sourcePath: fresh.sourcePath, citation: fresh.citation }),
        signal
      );
      assertInvocation(state, signal);
      const mapped = mapNavigationResult(result);
      if (mapped.kind !== "opened") return mapped;
      const afterNavigation = await readStablePage(
        state,
        binding.bundle,
        binding.authority.page.path,
        signal
      );
      if (
        afterNavigation.state !== "applied" ||
        createAuthorityIdentity(afterNavigation.authority) !==
          createAuthorityIdentity(binding.authority)
      ) {
        return STALE_RESULT;
      }
      const afterSession = state.projector.project(afterNavigation.authority);
      return findFreshEvidence(state.projector, afterSession, original) ? mapped : STALE_RESULT;
    } catch (error) {
      if (signal.aborted || isKnowledgeAbortError(error)) throw createAbortError();
      if (error instanceof PageNotApplied || error instanceof PageDrifted) return STALE_RESULT;
      const code = getKnowledgeAppliedWikiPageInspectorErrorCode(error);
      if (code === "not_applied" || code === "drifted") return STALE_RESULT;
      return UNAVAILABLE_RESULT;
    }
  }

  /** Lists strict bounded current page paths for the synchronous advisory index. */
  async listAppliedWikiPathIndexRows(
    signal: AbortSignal
  ): Promise<readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]> {
    const state = requireCoordinatorState(this);
    const rows: Readonly<KnowledgeAppliedWikiPathIndexRow>[] = [];
    try {
      for (const binding of state.bundles) {
        assertInvocation(state, signal);
        const projection = snapshotRuntimePathRows(
          binding.bundle,
          await state.runtime.readAppliedProvenance(binding.bundle.id),
          KNOWLEDGE_APPLIED_WIKI_PATH_INDEX_MAX_ROWS - rows.length
        );
        assertInvocation(state, signal);
        rows.push(...projection);
      }
      rows.sort((left, right) =>
        left.pagePath < right.pagePath
          ? -1
          : left.pagePath > right.pagePath
            ? 1
            : left.bundleId < right.bundleId
              ? -1
              : left.bundleId > right.bundleId
                ? 1
                : 0
      );
      return Object.freeze(rows);
    } catch (error) {
      if (signal.aborted || isKnowledgeAbortError(error)) throw createAbortError();
      throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
    }
  }
}

Object.freeze(KnowledgeProductionAppliedWikiPageInspectorCoordinator.prototype);
Object.freeze(KnowledgeProductionAppliedWikiPageInspectorCoordinator);
