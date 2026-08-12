import type { CompilerTargetRequest } from "@/knowledge/compiler/CompilerModelPort";
import {
  ObsidianKnowledgeCompilerTargetResolverError,
  type ObsidianKnowledgeCompilerTargetVisitPort,
  type ObsidianKnowledgeCompilerTargetVisitor,
} from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type { JsonValue, KnowledgeBundleConfig } from "@/knowledge/model/types";
import { validateKnowledgeBundleConfig } from "@/knowledge/model/validation";
import { isPathWithinRoot, parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS as RUNTIME_OUTPUT_LIMITS,
  type KnowledgeKnownAppliedWikiOutputAuthorityIdentity,
  type KnowledgeKnownAppliedWikiOutputIndexItem,
  type KnowledgeRuntimeKnownAppliedWikiOutputDetailSnapshot,
  type KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot,
} from "@/knowledge/runtime/KnowledgeKnownAppliedWikiOutputProjector";
import {
  KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS,
  KnowledgeKnownAppliedWikiOutputsError,
  snapshotKnowledgeKnownAppliedWikiOutputsRequest,
  type KnowledgeKnownAppliedWikiOutputComparisonResult,
  type KnowledgeKnownAppliedWikiOutputDetailResult,
  type KnowledgeKnownAppliedWikiOutputSummary,
  type KnowledgeKnownAppliedWikiOutputsPage,
  type KnowledgeKnownAppliedWikiOutputsPageResult,
  type KnowledgeKnownAppliedWikiOutputsPort,
  type KnowledgeKnownAppliedWikiOutputsRequest,
  type KnowledgeKnownAppliedWikiOutputsSession,
} from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";
import { sha256, sha256Bytes } from "@/utils/hash";

const DEFAULT_MAX_CONSISTENCY_ATTEMPTS = 3;
const MAX_BUNDLES = 256;
const MAX_SOURCE_ROOTS = 256;
const MAX_BUNDLE_ID_CHARACTERS = 256;
const MAX_PATH_CHARACTERS = 1_024;
const MAX_FILE_BYTES = 2_000_000;
const MAX_FILE_CHARACTERS = 2_000_000;
const MAX_INDEX_SNAPSHOT_CHARACTERS = 32_000_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OPAQUE_OUTPUT_PATTERN = /^known-wiki-output-[a-f0-9]{64}$/;
const OPAQUE_CURSOR_PATTERN = /^known-wiki-cursor-[a-f0-9]{64}$/;
const STALE_PAGE = Object.freeze({ kind: "stale" as const });
const UNAVAILABLE_PAGE = Object.freeze({ kind: "unavailable" as const });
const STALE_DETAIL = Object.freeze({ kind: "stale" as const });
const UNAVAILABLE_DETAIL = Object.freeze({ kind: "unavailable" as const });
const TOO_LARGE_DETAIL = Object.freeze({ kind: "too_large" as const });
const STALE_COMPARISON = Object.freeze({ kind: "stale" as const });
const UNAVAILABLE_COMPARISON = Object.freeze({ kind: "unavailable" as const });
const TOO_LARGE_COMPARISON = Object.freeze({ kind: "too_large" as const });

/** Narrow Runtime reads needed for retained applied-output browsing. */
export interface KnowledgeKnownAppliedWikiOutputsRuntimePort {
  /** Reads one metadata-only exact output index from a single Runtime envelope. */
  readKnownAppliedWikiOutputIndex(
    bundleId: string,
    pagePath: string
  ): Promise<KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot>;

  /** Rejoins one private metadata identity and returns at most one exact body. */
  readKnownAppliedWikiOutputDetail(
    bundleId: string,
    pagePath: string,
    authority: KnowledgeKnownAppliedWikiOutputAuthorityIdentity
  ): Promise<KnowledgeRuntimeKnownAppliedWikiOutputDetailSnapshot>;
}

/** One validated Bundle and its bounded read-before-content visitor. */
export interface KnowledgeProductionKnownAppliedWikiOutputsBundleBinding {
  readonly bundle: KnowledgeBundleConfig;
  readonly targetVisitor: ObsidianKnowledgeCompilerTargetVisitPort;
}

/** Read-only production dependencies captured by one worker generation. */
export interface KnowledgeProductionKnownAppliedWikiOutputsCoordinatorInput {
  readonly runtime: KnowledgeKnownAppliedWikiOutputsRuntimePort;
  readonly bundles: readonly Readonly<KnowledgeProductionKnownAppliedWikiOutputsBundleBinding>[];
  readonly assertCurrent: () => void;
  readonly maxConsistencyAttempts?: number;
}

interface CapturedRuntime {
  readonly readIndex: KnowledgeKnownAppliedWikiOutputsRuntimePort["readKnownAppliedWikiOutputIndex"];
  readonly readDetail: KnowledgeKnownAppliedWikiOutputsRuntimePort["readKnownAppliedWikiOutputDetail"];
}

interface CapturedBundle {
  readonly bundle: Readonly<KnowledgeBundleConfig>;
  readonly observeCurrent: (path: string, signal: AbortSignal) => Promise<CurrentObservation>;
}

interface CoordinatorState {
  readonly runtime: Readonly<CapturedRuntime>;
  readonly bundles: readonly Readonly<CapturedBundle>[];
  readonly assertCurrent: () => void;
  readonly maxConsistencyAttempts: number;
  readonly sessions: WeakMap<object, SessionBinding>;
}

interface CurrentFileObservation {
  readonly kind: "file";
  readonly path: string;
  readonly content: string;
  readonly contentHash: string;
}

interface CurrentMissingObservation {
  readonly kind: "missing";
  readonly path: string;
}

type CurrentObservation = CurrentFileObservation | CurrentMissingObservation;

interface OutputBinding {
  readonly outputRef: string;
  readonly item: Readonly<KnowledgeKnownAppliedWikiOutputIndexItem>;
  readonly summary: Readonly<KnowledgeKnownAppliedWikiOutputSummary>;
}

/** Monotonic subsystem revisions observed from one atomic Runtime envelope. */
interface RuntimeRevisionVector {
  readonly runtimeRevision: number;
  readonly manifestRevision: number;
  readonly reviewRevision: number | null;
}

interface SessionBinding {
  readonly bundle: Readonly<CapturedBundle>;
  readonly pagePath: string;
  readonly semanticDigest: string;
  readonly observationDigest: string;
  readonly outputs: readonly Readonly<OutputBinding>[];
  readonly outputByRef: ReadonlyMap<string, Readonly<OutputBinding>>;
  readonly cursorOffsets: ReadonlyMap<string, number>;
  readonly consumedCursors: Set<string>;
  readonly session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>;
  latestRevisions: Readonly<RuntimeRevisionVector>;
}

interface StableRead {
  readonly bundle: Readonly<CapturedBundle>;
  readonly index: Readonly<KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot>;
  readonly semanticDigest: string;
  readonly observation: Readonly<CurrentObservation>;
  readonly observationDigest: string;
}

interface DetailRead {
  readonly detail: Extract<
    KnowledgeRuntimeKnownAppliedWikiOutputDetailSnapshot,
    { kind: "available" }
  >;
  readonly observation: Readonly<CurrentObservation>;
}

class RetryConsistency extends Error {}
class StaleSession extends Error {}
class UnavailableRead extends Error {}
class TooLargeRead extends Error {}

const coordinatorStates = new WeakMap<object, CoordinatorState>();

/** Creates platform-standard cancellation without retaining a caller reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Reads an own enumerable data property without invoking an accessor. */
function readDataProperty(value: unknown, key: string): unknown {
  try {
    if (typeof value !== "object" || value === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Captures an exact plain data record without retaining caller objects. */
function snapshotRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    const permitted = new Set([...requiredKeys, ...optionalKeys]);
    if (
      keys.length < requiredKeys.length ||
      keys.length > requiredKeys.length + optionalKeys.length ||
      keys.some((key) => typeof key !== "string" || !permitted.has(key)) ||
      requiredKeys.some((key) => !keys.includes(key))
    ) {
      return undefined;
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Captures one dense bounded array through data descriptors only. */
function snapshotArray(value: unknown, maxLength: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : -1;
    if (
      !Number.isSafeInteger(length) ||
      Number(length) < 0 ||
      Number(length) > maxLength ||
      Reflect.ownKeys(value).length !== Number(length) + 1
    ) {
      return undefined;
    }
    const result: unknown[] = [];
    for (let index = 0; index < Number(length); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Finds a callable data method through a bounded acyclic prototype chain. */
function captureMethod(value: object, name: string): ((...args: unknown[]) => unknown) | undefined {
  try {
    let owner: object | null = value;
    const visited = new Set<object>();
    while (owner && visited.size < 64 && !visited.has(owner)) {
      visited.add(owner);
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "function"
          ? (descriptor.value as (...args: unknown[]) => unknown)
          : undefined;
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Stops work around every asynchronous authority boundary. */
function assertInvocation(state: CoordinatorState, signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError();
  state.assertCurrent();
  if (signal.aborted) throw createAbortError();
}

/** Captures the two exact Runtime read methods with their receiver. */
function captureRuntime(value: unknown): Readonly<CapturedRuntime> {
  if (typeof value !== "object" || value === null) throw createAbortError();
  const readIndex = captureMethod(value, "readKnownAppliedWikiOutputIndex");
  const readDetail = captureMethod(value, "readKnownAppliedWikiOutputDetail");
  if (!readIndex || !readDetail) throw createAbortError();
  return Object.freeze({
    readIndex: (bundleId: string, pagePath: string) =>
      Promise.resolve(
        Reflect.apply(readIndex, value, [
          bundleId,
          pagePath,
        ]) as Promise<KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot>
      ),
    readDetail: (
      bundleId: string,
      pagePath: string,
      authority: KnowledgeKnownAppliedWikiOutputAuthorityIdentity
    ) =>
      Promise.resolve(
        Reflect.apply(readDetail, value, [
          bundleId,
          pagePath,
          authority,
        ]) as Promise<KnowledgeRuntimeKnownAppliedWikiOutputDetailSnapshot>
      ),
  });
}

/** Reports whether two configured paths overlap under Windows semantics. */
function pathsOverlap(left: string, right: string): boolean {
  return isPathWithinRoot(left, right) || isPathWithinRoot(right, left);
}

/** Captures one strict Bundle while bounding all pre-validation strings. */
function snapshotBundle(value: unknown): Readonly<KnowledgeBundleConfig> | undefined {
  const record = snapshotRecord(value, [
    "version",
    "id",
    "sourceRoots",
    "wikiRoot",
    "schemaRef",
    "reviewMode",
  ]);
  const sourceRoots = record ? snapshotArray(record.sourceRoots, MAX_SOURCE_ROOTS) : undefined;
  if (
    !record ||
    !sourceRoots ||
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    record.id.length > MAX_BUNDLE_ID_CHARACTERS ||
    typeof record.wikiRoot !== "string" ||
    record.wikiRoot.length > MAX_PATH_CHARACTERS ||
    typeof record.schemaRef !== "string" ||
    record.schemaRef.length > MAX_PATH_CHARACTERS ||
    sourceRoots.some((root) => typeof root !== "string" || root.length > MAX_PATH_CHARACTERS)
  ) {
    return undefined;
  }
  const bundle = Object.freeze({
    version: record.version,
    id: record.id,
    sourceRoots: Object.freeze([...sourceRoots]) as unknown as string[],
    wikiRoot: record.wikiRoot,
    schemaRef: record.schemaRef,
    reviewMode: record.reviewMode,
  }) as KnowledgeBundleConfig;
  return validateKnowledgeBundleConfig(bundle).valid ? bundle : undefined;
}

/** Captures one target visitor and projects exactly one bounded current file. */
function captureCurrentObserver(
  value: unknown
): (path: string, signal: AbortSignal) => Promise<CurrentObservation> {
  if (typeof value !== "object" || value === null) throw createAbortError();
  const visit = captureMethod(value, "visit");
  if (!visit) throw createAbortError();
  return async (path, signal) => {
    const request = Object.freeze({
      targetId: "known-applied-wiki-current",
      path,
      intent: "write" as const,
      access: "authorized" as const,
    });
    let projected: CurrentObservation | undefined;
    let callbackActive = false;
    let visitActive = true;
    const visitor: ObsidianKnowledgeCompilerTargetVisitor = async (value, fileByteSize) => {
      if (!visitActive || callbackActive || projected) throw new RetryConsistency();
      callbackActive = true;
      try {
        projected = projectCurrentObservation(value, fileByteSize, request);
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
    if (callbackActive || !projected) throw new RetryConsistency();
    return projected;
  };
}

/** Strictly detaches the single visitor callback payload. */
function projectCurrentObservation(
  value: unknown,
  fileByteSize: number | undefined,
  request: Readonly<CompilerTargetRequest>
): CurrentObservation {
  const kind = readDataProperty(value, "kind");
  if (kind === "missing") {
    const record = snapshotRecord(value, ["targetId", "kind", "windowsPathKey"]);
    if (
      !record ||
      record.targetId !== request.targetId ||
      record.windowsPathKey !== toWindowsPathKey(request.path) ||
      fileByteSize !== undefined
    ) {
      throw new RetryConsistency();
    }
    return Object.freeze({ kind: "missing" as const, path: request.path });
  }
  if (kind === "directory" || kind === "occupied") throw new UnavailableRead();
  const record = snapshotRecord(value, ["targetId", "kind", "path", "content"]);
  if (
    !record ||
    record.kind !== "file" ||
    record.targetId !== request.targetId ||
    record.path !== request.path ||
    typeof record.content !== "string" ||
    record.content.length > MAX_FILE_CHARACTERS ||
    !Number.isSafeInteger(fileByteSize) ||
    Number(fileByteSize) < 0 ||
    Number(fileByteSize) > MAX_FILE_BYTES
  ) {
    throw new RetryConsistency();
  }
  const bytes = new TextEncoder().encode(record.content);
  if (bytes.byteLength !== fileByteSize) throw new RetryConsistency();
  return Object.freeze({
    kind: "file" as const,
    path: request.path,
    content: record.content,
    contentHash: sha256Bytes(bytes),
  });
}

/** Captures and cross-validates every Bundle/visitor dependency. */
function snapshotBundles(value: unknown): readonly Readonly<CapturedBundle>[] {
  const values = snapshotArray(value, MAX_BUNDLES);
  if (!values || values.length === 0) throw createAbortError();
  const bundles = values.map((item) => {
    const record = snapshotRecord(item, ["bundle", "targetVisitor"]);
    const bundle = record ? snapshotBundle(record.bundle) : undefined;
    if (!record || !bundle) throw createAbortError();
    return Object.freeze({
      bundle,
      observeCurrent: captureCurrentObserver(record.targetVisitor),
    });
  });
  const bundleIds = new Set<string>();
  for (let leftIndex = 0; leftIndex < bundles.length; leftIndex += 1) {
    const left = bundles[leftIndex].bundle;
    if (bundleIds.has(left.id)) throw createAbortError();
    bundleIds.add(left.id);
    for (let rightIndex = leftIndex + 1; rightIndex < bundles.length; rightIndex += 1) {
      const right = bundles[rightIndex].bundle;
      if (
        pathsOverlap(left.wikiRoot, right.wikiRoot) ||
        left.sourceRoots.some((root) => pathsOverlap(root, right.wikiRoot)) ||
        right.sourceRoots.some((root) => pathsOverlap(root, left.wikiRoot)) ||
        isPathWithinRoot(left.schemaRef, right.wikiRoot) ||
        isPathWithinRoot(right.schemaRef, left.wikiRoot)
      ) {
        throw createAbortError();
      }
    }
  }
  return Object.freeze(bundles);
}

/** Captures the constructor surface before evaluating any dependency. */
function snapshotInput(
  value: unknown
): Readonly<KnowledgeProductionKnownAppliedWikiOutputsCoordinatorInput> {
  const record =
    snapshotRecord(value, ["runtime", "bundles", "assertCurrent"]) ??
    snapshotRecord(value, ["runtime", "bundles", "assertCurrent", "maxConsistencyAttempts"]);
  if (
    !record ||
    typeof record.assertCurrent !== "function" ||
    (record.maxConsistencyAttempts !== undefined &&
      (!Number.isSafeInteger(record.maxConsistencyAttempts) ||
        Number(record.maxConsistencyAttempts) < 1 ||
        Number(record.maxConsistencyAttempts) > 10))
  ) {
    throw createAbortError();
  }
  return Object.freeze({
    runtime: record.runtime as KnowledgeKnownAppliedWikiOutputsRuntimePort,
    bundles:
      record.bundles as readonly Readonly<KnowledgeProductionKnownAppliedWikiOutputsBundleBinding>[],
    assertCurrent: record.assertCurrent as () => void,
    ...(record.maxConsistencyAttempts === undefined
      ? {}
      : { maxConsistencyAttempts: Number(record.maxConsistencyAttempts) }),
  });
}

/** Captures one private Runtime detail authority exactly. */
function snapshotAuthority(
  value: unknown,
  budget: { characters: number }
): Readonly<KnowledgeKnownAppliedWikiOutputAuthorityIdentity> | undefined {
  const keys = [
    "runtimeId",
    "bundleId",
    "pagePath",
    "windowsPathKey",
    "outputPath",
    "contentHash",
    "characterCount",
    "transactionId",
    "sourceId",
    "sourceContentHash",
    "pipelineFingerprint",
    "inputRevision",
    "changeSetId",
    "changeSetDigest",
    "manifestIntentDigest",
    "manifestAfterRevision",
    "manifestAfterDigest",
    "appliedAt",
  ];
  const record = snapshotRecord(value, keys);
  if (!record) return undefined;
  const identifierFields = [
    "runtimeId",
    "bundleId",
    "transactionId",
    "sourceId",
    "changeSetId",
  ] as const;
  const digestFields = [
    "contentHash",
    "sourceContentHash",
    "pipelineFingerprint",
    "changeSetDigest",
    "manifestIntentDigest",
    "manifestAfterDigest",
  ] as const;
  const pathFields = ["pagePath", "windowsPathKey", "outputPath"] as const;
  const stringValues = [...identifierFields, ...digestFields, ...pathFields].map(
    (field) => record[field]
  );
  if (
    stringValues.some((item) => typeof item !== "string") ||
    identifierFields.some(
      (field) =>
        (record[field] as string).length === 0 ||
        (record[field] as string).length > RUNTIME_OUTPUT_LIMITS.maxIdentifierCharacters
    ) ||
    digestFields.some((field) => !SHA256_PATTERN.test(record[field] as string)) ||
    pathFields.some((field) => (record[field] as string).length > MAX_PATH_CHARACTERS)
  ) {
    return undefined;
  }
  for (const item of stringValues as string[]) {
    budget.characters += item.length;
    if (budget.characters > MAX_INDEX_SNAPSHOT_CHARACTERS) return undefined;
  }
  const pagePath = record.pagePath as string;
  const outputPath = record.outputPath as string;
  const parsedPage = parseVaultPath(pagePath);
  const parsedOutput = parseVaultPath(outputPath);
  if (
    !parsedPage.ok ||
    parsedPage.path !== pagePath ||
    !parsedOutput.ok ||
    parsedOutput.path !== outputPath ||
    record.windowsPathKey !== toWindowsPathKey(pagePath) ||
    toWindowsPathKey(outputPath) !== record.windowsPathKey ||
    !Number.isSafeInteger(record.characterCount) ||
    Number(record.characterCount) < 0 ||
    !Number.isSafeInteger(record.inputRevision) ||
    Number(record.inputRevision) < 0 ||
    !Number.isSafeInteger(record.manifestAfterRevision) ||
    Number(record.manifestAfterRevision) < 1 ||
    !Number.isSafeInteger(record.appliedAt) ||
    Number(record.appliedAt) < 0
  ) {
    return undefined;
  }
  return Object.freeze({
    runtimeId: record.runtimeId as string,
    bundleId: record.bundleId as string,
    pagePath,
    windowsPathKey: record.windowsPathKey,
    outputPath,
    contentHash: record.contentHash as string,
    characterCount: Number(record.characterCount),
    transactionId: record.transactionId as string,
    sourceId: record.sourceId as string,
    sourceContentHash: record.sourceContentHash as string,
    pipelineFingerprint: record.pipelineFingerprint as string,
    inputRevision: Number(record.inputRevision),
    changeSetId: record.changeSetId as string,
    changeSetDigest: record.changeSetDigest as string,
    manifestIntentDigest: record.manifestIntentDigest as string,
    manifestAfterRevision: Number(record.manifestAfterRevision),
    manifestAfterDigest: record.manifestAfterDigest as string,
    appliedAt: Number(record.appliedAt),
  });
}

/** Captures a deep-frozen metadata index returned by the Runtime boundary. */
function snapshotIndex(
  value: unknown,
  expectedBundleId: string,
  expectedPagePath: string
): Readonly<KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot> {
  const record = snapshotRecord(value, [
    "runtimeId",
    "runtimeRevision",
    "bundleId",
    "pagePath",
    "windowsPathKey",
    "reviewRevision",
    "manifestRevision",
    "currentManifestPage",
    "outputs",
  ]);
  const outputValues = record
    ? snapshotArray(record.outputs, RUNTIME_OUTPUT_LIMITS.maxPageOutputs)
    : undefined;
  if (
    !record ||
    !outputValues ||
    typeof record.runtimeId !== "string" ||
    record.runtimeId.length === 0 ||
    record.runtimeId.length > RUNTIME_OUTPUT_LIMITS.maxIdentifierCharacters ||
    record.bundleId !== expectedBundleId ||
    record.pagePath !== expectedPagePath ||
    record.windowsPathKey !== toWindowsPathKey(expectedPagePath) ||
    !Number.isSafeInteger(record.runtimeRevision) ||
    Number(record.runtimeRevision) < 0 ||
    (record.reviewRevision !== null &&
      (!Number.isSafeInteger(record.reviewRevision) || Number(record.reviewRevision) < 0)) ||
    !Number.isSafeInteger(record.manifestRevision) ||
    Number(record.manifestRevision) < 0
  ) {
    throw new UnavailableRead();
  }
  const budget = {
    characters: record.runtimeId.length + expectedBundleId.length + expectedPagePath.length,
  };
  const currentRecord =
    record.currentManifestPage === null
      ? undefined
      : snapshotRecord(record.currentManifestPage, [
          "path",
          "windowsPathKey",
          "ownership",
          "contentHash",
        ]);
  let currentManifestPage: Readonly<{
    path: string;
    windowsPathKey: string;
    ownership: "generated" | "shared" | "user";
    contentHash: string;
  }> | null = null;
  if (record.currentManifestPage !== null) {
    if (
      !currentRecord ||
      currentRecord.path !== expectedPagePath ||
      currentRecord.windowsPathKey !== toWindowsPathKey(expectedPagePath) ||
      (currentRecord.ownership !== "generated" &&
        currentRecord.ownership !== "shared" &&
        currentRecord.ownership !== "user") ||
      typeof currentRecord.contentHash !== "string" ||
      !SHA256_PATTERN.test(currentRecord.contentHash)
    ) {
      throw new UnavailableRead();
    }
    currentManifestPage = Object.freeze({
      path: expectedPagePath,
      windowsPathKey: currentRecord.windowsPathKey,
      ownership: currentRecord.ownership,
      contentHash: currentRecord.contentHash,
    });
  }
  const outputs: Readonly<KnowledgeKnownAppliedWikiOutputIndexItem>[] = [];
  const contentHashes = new Set<string>();
  for (const raw of outputValues) {
    const item = snapshotRecord(raw, [
      "path",
      "windowsPathKey",
      "contentHash",
      "characterCount",
      "detailAvailability",
      "newestAppliedAt",
      "newestManifestRevision",
      "verifiedApplyCount",
      "authority",
    ]);
    const authority = item ? snapshotAuthority(item.authority, budget) : undefined;
    if (
      !item ||
      !authority ||
      typeof item.path !== "string" ||
      item.path.length > MAX_PATH_CHARACTERS ||
      item.path !== expectedPagePath ||
      item.windowsPathKey !== toWindowsPathKey(expectedPagePath) ||
      typeof item.contentHash !== "string" ||
      !SHA256_PATTERN.test(item.contentHash) ||
      contentHashes.has(item.contentHash) ||
      !Number.isSafeInteger(item.characterCount) ||
      Number(item.characterCount) < 0 ||
      (item.detailAvailability !== "available" && item.detailAvailability !== "too_large") ||
      !Number.isSafeInteger(item.newestAppliedAt) ||
      Number(item.newestAppliedAt) < 0 ||
      !Number.isSafeInteger(item.newestManifestRevision) ||
      Number(item.newestManifestRevision) < 1 ||
      !Number.isSafeInteger(item.verifiedApplyCount) ||
      Number(item.verifiedApplyCount) < 1 ||
      Number(item.verifiedApplyCount) > RUNTIME_OUTPUT_LIMITS.maxApplyCommits ||
      authority.runtimeId !== record.runtimeId ||
      authority.bundleId !== expectedBundleId ||
      authority.pagePath !== expectedPagePath ||
      authority.windowsPathKey !== item.windowsPathKey ||
      authority.outputPath !== item.path ||
      authority.contentHash !== item.contentHash ||
      authority.characterCount !== item.characterCount ||
      authority.appliedAt !== item.newestAppliedAt ||
      authority.manifestAfterRevision !== item.newestManifestRevision
    ) {
      throw new UnavailableRead();
    }
    const parsed = parseVaultPath(item.path);
    if (!parsed.ok || parsed.path !== item.path) throw new UnavailableRead();
    budget.characters += item.path.length + item.contentHash.length;
    if (budget.characters > MAX_INDEX_SNAPSHOT_CHARACTERS) throw new UnavailableRead();
    contentHashes.add(item.contentHash);
    outputs.push(
      Object.freeze({
        path: item.path,
        windowsPathKey: item.windowsPathKey,
        contentHash: item.contentHash,
        characterCount: Number(item.characterCount),
        detailAvailability: item.detailAvailability,
        newestAppliedAt: Number(item.newestAppliedAt),
        newestManifestRevision: Number(item.newestManifestRevision),
        verifiedApplyCount: Number(item.verifiedApplyCount),
        authority,
      })
    );
  }
  for (let index = 1; index < outputs.length; index += 1) {
    const previous = outputs[index - 1];
    const current = outputs[index];
    const ordered =
      previous.newestAppliedAt > current.newestAppliedAt ||
      (previous.newestAppliedAt === current.newestAppliedAt &&
        (previous.newestManifestRevision > current.newestManifestRevision ||
          (previous.newestManifestRevision === current.newestManifestRevision &&
            previous.contentHash <= current.contentHash)));
    if (!ordered) throw new UnavailableRead();
  }
  return Object.freeze({
    runtimeId: record.runtimeId,
    runtimeRevision: Number(record.runtimeRevision),
    bundleId: expectedBundleId,
    pagePath: expectedPagePath,
    windowsPathKey: record.windowsPathKey,
    reviewRevision: record.reviewRevision === null ? null : Number(record.reviewRevision),
    manifestRevision: Number(record.manifestRevision),
    currentManifestPage,
    outputs: Object.freeze(outputs),
  });
}

/** Creates a semantic digest that ignores unrelated Runtime revision advances. */
function createIndexSemanticDigest(
  value: Readonly<KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot>
): string {
  return sha256(
    canonicalizeJson({
      runtimeId: value.runtimeId,
      bundleId: value.bundleId,
      pagePath: value.pagePath,
      windowsPathKey: value.windowsPathKey,
      currentManifestPage: value.currentManifestPage,
      outputs: value.outputs,
    } as unknown as JsonValue)
  );
}

/** Captures only the monotonic counters from one validated Runtime index. */
function createRevisionVector(
  value: Readonly<KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot>
): Readonly<RuntimeRevisionVector> {
  return Object.freeze({
    runtimeRevision: value.runtimeRevision,
    manifestRevision: value.manifestRevision,
    reviewRevision: value.reviewRevision,
  });
}

/** Reports whether a later optional Review counter did not disappear or decrease. */
function reviewRevisionDoesNotRegress(before: number | null, after: number | null): boolean {
  return before === null || (after !== null && after >= before);
}

/** Reports whether all atomic Runtime counters moved monotonically forward. */
function revisionsDoNotRegress(
  before: Readonly<RuntimeRevisionVector>,
  after: Readonly<RuntimeRevisionVector>
): boolean {
  return (
    after.runtimeRevision >= before.runtimeRevision &&
    after.manifestRevision >= before.manifestRevision &&
    reviewRevisionDoesNotRegress(before.reviewRevision, after.reviewRevision)
  );
}

/** Advances one session revision floor or revokes it on a backward read. */
function advanceSessionRevisions(
  binding: SessionBinding,
  next: Readonly<RuntimeRevisionVector>
): void {
  if (!revisionsDoNotRegress(binding.latestRevisions, next)) throw new StaleSession();
  binding.latestRevisions = next;
}

/** Creates one exact current-file snapshot digest. */
function createObservationDigest(value: Readonly<CurrentObservation>): string {
  return sha256(
    canonicalizeJson(
      value.kind === "file"
        ? { kind: value.kind, path: value.path, contentHash: value.contentHash }
        : { kind: value.kind, path: value.path }
    )
  );
}

/** Returns the one Bundle whose Wiki root contains the exact requested path. */
function selectBundle(
  state: CoordinatorState,
  pagePath: string
): Readonly<CapturedBundle> | undefined {
  const matches = state.bundles.filter((binding) =>
    isPathWithinRoot(pagePath, binding.bundle.wikiRoot)
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Reads one Runtime/Vault/Runtime consistency sandwich with bounded retries. */
async function readStable(
  state: CoordinatorState,
  bundle: Readonly<CapturedBundle>,
  pagePath: string,
  signal: AbortSignal
): Promise<StableRead> {
  for (let attempt = 0; attempt < state.maxConsistencyAttempts; attempt += 1) {
    assertInvocation(state, signal);
    const before = snapshotIndex(
      await state.runtime.readIndex(bundle.bundle.id, pagePath),
      bundle.bundle.id,
      pagePath
    );
    assertInvocation(state, signal);
    let observation: CurrentObservation;
    try {
      observation = await bundle.observeCurrent(pagePath, signal);
    } catch (error) {
      const code = ObsidianKnowledgeCompilerTargetResolverError.inspect(error);
      if (code === "resource_limit") throw new TooLargeRead();
      if (code === "aborted" || signal.aborted) throw createAbortError();
      if (error instanceof RetryConsistency) continue;
      throw new UnavailableRead();
    }
    assertInvocation(state, signal);
    const after = snapshotIndex(
      await state.runtime.readIndex(bundle.bundle.id, pagePath),
      bundle.bundle.id,
      pagePath
    );
    assertInvocation(state, signal);
    const beforeDigest = createIndexSemanticDigest(before);
    const afterDigest = createIndexSemanticDigest(after);
    if (
      beforeDigest !== afterDigest ||
      !revisionsDoNotRegress(createRevisionVector(before), createRevisionVector(after))
    ) {
      continue;
    }
    if (!after.currentManifestPage || after.outputs.length === 0) {
      throw new KnowledgeKnownAppliedWikiOutputsError("not_known");
    }
    return Object.freeze({
      bundle,
      index: after,
      semanticDigest: afterDigest,
      observation,
      observationDigest: createObservationDigest(observation),
    });
  }
  throw new UnavailableRead();
}

/** Classifies only a strict Manifest+output+Vault triple as current applied. */
function classifyCurrent(read: StableRead): {
  state: "applied" | "drifted" | "missing";
  match: "current_applied" | "earlier_known" | "none";
  currentOutput?: KnowledgeKnownAppliedWikiOutputIndexItem;
} {
  if (read.observation.kind === "missing") return { state: "missing", match: "none" };
  const manifestHash = read.index.currentManifestPage?.contentHash;
  const currentOutput = read.index.outputs.find((item) => item.contentHash === manifestHash);
  if (manifestHash && currentOutput && read.observation.contentHash === manifestHash) {
    return { state: "applied", match: "current_applied", currentOutput };
  }
  return {
    state: "drifted",
    match: read.index.outputs.some(
      (item) =>
        read.observation.kind === "file" && item.contentHash === read.observation.contentHash
    )
      ? "earlier_known"
      : "none",
  };
}

/** Creates one opaque ref bound privately to a semantic session. */
function createOpaqueRef(
  kind: "page" | "output" | "cursor",
  semanticDigest: string,
  identity: JsonValue
): string {
  return `known-wiki-${kind}-${sha256(
    canonicalizeJson(["known-applied-wiki-output-v1", kind, semanticDigest, identity])
  )}`;
}

/** Creates one bounded metadata page from private output bindings. */
function createPage(
  bindings: readonly Readonly<OutputBinding>[],
  cursorOffsets: Map<string, number>,
  semanticDigest: string,
  offset: number
): Readonly<KnowledgeKnownAppliedWikiOutputsPage> {
  const items = Object.freeze(
    bindings
      .slice(offset, offset + KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.pageSize)
      .map((binding) => binding.summary)
  );
  const nextOffset = offset + items.length;
  if (nextOffset >= bindings.length) return Object.freeze({ items });
  const cursor = createOpaqueRef("cursor", semanticDigest, nextOffset);
  cursorOffsets.set(cursor, nextOffset);
  return Object.freeze({ items, nextCursor: cursor });
}

/** Creates the initial authentic session and its private bindings. */
function createSessionBinding(read: StableRead): SessionBinding {
  const classification = classifyCurrent(read);
  const ordered = [...read.index.outputs];
  if (classification.currentOutput) {
    const index = ordered.indexOf(classification.currentOutput);
    if (index > 0) ordered.unshift(...ordered.splice(index, 1));
  }
  const outputBindings = ordered.map((item, index) => {
    const outputRef = createOpaqueRef("output", read.semanticDigest, [item.contentHash, index]);
    const relation =
      index === 0
        ? classification.state === "applied"
          ? ("current_applied" as const)
          : ("latest_known" as const)
        : ("earlier_known" as const);
    return Object.freeze({
      outputRef,
      item,
      summary: Object.freeze({
        outputRef,
        appliedAt: item.newestAppliedAt,
        verifiedApplyCount: item.verifiedApplyCount,
        relation,
      }),
    });
  });
  const cursorOffsets = new Map<string, number>();
  const firstPage = createPage(outputBindings, cursorOffsets, read.semanticDigest, 0);
  const pageRef = createOpaqueRef("page", read.semanticDigest, [
    read.observationDigest,
    read.index.pagePath,
  ]);
  const session = Object.freeze({
    pageRef,
    displayPagePath: read.index.pagePath,
    currentState: classification.state,
    currentMatch: classification.match,
    knownOutputCount: outputBindings.length,
    items: firstPage.items,
    ...(firstPage.nextCursor === undefined ? {} : { nextCursor: firstPage.nextCursor }),
  });
  return {
    bundle: read.bundle,
    pagePath: read.index.pagePath,
    semanticDigest: read.semanticDigest,
    observationDigest: read.observationDigest,
    outputs: Object.freeze(outputBindings),
    outputByRef: new Map(outputBindings.map((binding) => [binding.outputRef, binding])),
    cursorOffsets,
    consumedCursors: new Set(),
    session,
    latestRevisions: createRevisionVector(read.index),
  };
}

/** Re-proves an authentic session without rejecting unrelated Runtime commits. */
async function reproveSession(
  state: CoordinatorState,
  binding: SessionBinding,
  signal: AbortSignal
): Promise<StableRead> {
  let read: StableRead;
  try {
    read = await readStable(state, binding.bundle, binding.pagePath, signal);
  } catch (error) {
    if (error instanceof KnowledgeKnownAppliedWikiOutputsError) throw new StaleSession();
    throw error;
  }
  if (
    read.semanticDigest !== binding.semanticDigest ||
    read.observationDigest !== binding.observationDigest
  ) {
    throw new StaleSession();
  }
  advanceSessionRevisions(binding, createRevisionVector(read.index));
  return read;
}

/** Captures and verifies one Runtime detail response against its private item. */
function snapshotDetail(
  value: unknown,
  item: Readonly<KnowledgeKnownAppliedWikiOutputIndexItem>
): KnowledgeRuntimeKnownAppliedWikiOutputDetailSnapshot {
  const kind = readDataProperty(value, "kind");
  if (kind === "stale") {
    const record = snapshotRecord(value, ["kind", "runtimeId", "runtimeRevision"]);
    if (
      !record ||
      record.runtimeId !== item.authority.runtimeId ||
      !Number.isSafeInteger(record.runtimeRevision) ||
      Number(record.runtimeRevision) < 0
    ) {
      throw new UnavailableRead();
    }
    return Object.freeze({
      kind: "stale" as const,
      runtimeId: String(record.runtimeId),
      runtimeRevision: Number(record.runtimeRevision),
    });
  }
  if (kind === "too_large") {
    const record = snapshotRecord(value, [
      "kind",
      "runtimeId",
      "runtimeRevision",
      "contentHash",
      "characterCount",
    ]);
    if (
      !record ||
      record.runtimeId !== item.authority.runtimeId ||
      !Number.isSafeInteger(record.runtimeRevision) ||
      Number(record.runtimeRevision) < 0 ||
      record.contentHash !== item.contentHash ||
      record.characterCount !== item.characterCount
    ) {
      throw new UnavailableRead();
    }
    return Object.freeze({
      kind: "too_large" as const,
      runtimeId: String(record.runtimeId),
      runtimeRevision: Number(record.runtimeRevision),
      contentHash: item.contentHash,
      characterCount: item.characterCount,
    });
  }
  const record = snapshotRecord(value, [
    "kind",
    "runtimeId",
    "runtimeRevision",
    "contentHash",
    "content",
    "characterCount",
  ]);
  if (
    !record ||
    record.kind !== "available" ||
    record.runtimeId !== item.authority.runtimeId ||
    !Number.isSafeInteger(record.runtimeRevision) ||
    Number(record.runtimeRevision) < 0 ||
    record.contentHash !== item.contentHash ||
    record.characterCount !== item.characterCount ||
    typeof record.content !== "string" ||
    record.content.length !== item.characterCount ||
    record.content.length > RUNTIME_OUTPUT_LIMITS.maxContentCharacters ||
    createFileContentHash(record.content) !== item.contentHash
  ) {
    throw new UnavailableRead();
  }
  return Object.freeze({
    kind: "available" as const,
    runtimeId: String(record.runtimeId),
    runtimeRevision: Number(record.runtimeRevision),
    contentHash: item.contentHash,
    content: record.content,
    characterCount: item.characterCount,
  });
}

/** Reads detail twice around the current file and proves the session stayed exact. */
async function readDetailSandwich(
  state: CoordinatorState,
  binding: SessionBinding,
  output: Readonly<OutputBinding>,
  signal: AbortSignal
): Promise<DetailRead> {
  const before = await reproveSession(state, binding, signal);
  assertInvocation(state, signal);
  const first = snapshotDetail(
    await state.runtime.readDetail(
      binding.bundle.bundle.id,
      binding.pagePath,
      output.item.authority
    ),
    output.item
  );
  assertInvocation(state, signal);
  if (first.runtimeRevision < before.index.runtimeRevision) throw new StaleSession();
  if (first.runtimeRevision < binding.latestRevisions.runtimeRevision) throw new StaleSession();
  let observation: CurrentObservation;
  try {
    observation = await binding.bundle.observeCurrent(binding.pagePath, signal);
  } catch (error) {
    const code = ObsidianKnowledgeCompilerTargetResolverError.inspect(error);
    if (code === "resource_limit") throw new TooLargeRead();
    if (code === "aborted" || signal.aborted) throw createAbortError();
    throw new UnavailableRead();
  }
  assertInvocation(state, signal);
  const second = snapshotDetail(
    await state.runtime.readDetail(
      binding.bundle.bundle.id,
      binding.pagePath,
      output.item.authority
    ),
    output.item
  );
  assertInvocation(state, signal);
  if (second.runtimeRevision < first.runtimeRevision) throw new StaleSession();
  const afterIndex = snapshotIndex(
    await state.runtime.readIndex(binding.bundle.bundle.id, binding.pagePath),
    binding.bundle.bundle.id,
    binding.pagePath
  );
  assertInvocation(state, signal);
  const afterRevisions = createRevisionVector(afterIndex);
  if (
    before.semanticDigest !== binding.semanticDigest ||
    createIndexSemanticDigest(afterIndex) !== binding.semanticDigest ||
    createObservationDigest(observation) !== binding.observationDigest ||
    afterIndex.runtimeRevision < second.runtimeRevision ||
    !revisionsDoNotRegress(createRevisionVector(before.index), afterRevisions) ||
    first.kind === "stale" ||
    second.kind === "stale"
  ) {
    throw new StaleSession();
  }
  advanceSessionRevisions(binding, afterRevisions);
  if (first.kind === "too_large" || second.kind === "too_large") throw new TooLargeRead();
  if (
    first.contentHash !== second.contentHash ||
    first.characterCount !== second.characterCount ||
    first.content !== second.content
  ) {
    throw new StaleSession();
  }
  return Object.freeze({ detail: second, observation });
}

/** Returns hidden coordinator state only for an authentic instance. */
function requireState(value: unknown): CoordinatorState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeProductionKnownAppliedWikiOutputsCoordinator.prototype
  ) {
    throw createAbortError();
  }
  const state = coordinatorStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Resolves only an authentic module-issued current session. */
function resolveBinding(
  state: CoordinatorState,
  session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>
): SessionBinding | undefined {
  return typeof session === "object" && session !== null ? state.sessions.get(session) : undefined;
}

/** Production read-only known-applied-output coordinator. */
export class KnowledgeProductionKnownAppliedWikiOutputsCoordinator
  implements KnowledgeKnownAppliedWikiOutputsPort
{
  /** Captures one exact worker generation and no write/model/network capability. */
  constructor(inputValue: KnowledgeProductionKnownAppliedWikiOutputsCoordinatorInput) {
    const input = snapshotInput(inputValue);
    coordinatorStates.set(this, {
      runtime: captureRuntime(input.runtime),
      bundles: snapshotBundles(input.bundles),
      assertCurrent: input.assertCurrent,
      maxConsistencyAttempts: input.maxConsistencyAttempts ?? DEFAULT_MAX_CONSISTENCY_ATTEMPTS,
      sessions: new WeakMap(),
    });
    Object.freeze(this);
  }

  /** Opens a bounded metadata-only session for one exact tracked Wiki path. */
  async inspectKnownOutputs(
    requestValue: Readonly<KnowledgeKnownAppliedWikiOutputsRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputsSession>> {
    const state = requireState(this);
    const request = snapshotKnowledgeKnownAppliedWikiOutputsRequest(requestValue);
    assertInvocation(state, signal);
    const bundle = selectBundle(state, request.pagePath);
    if (!bundle) throw new KnowledgeKnownAppliedWikiOutputsError("not_known");
    try {
      const read = await readStable(state, bundle, request.pagePath, signal);
      const binding = createSessionBinding(read);
      state.sessions.set(binding.session, binding);
      return binding.session;
    } catch (error) {
      if (error instanceof KnowledgeKnownAppliedWikiOutputsError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
    }
  }

  /** Loads one full next page through an authentic single-use cursor. */
  async listMore(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    cursor: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputsPageResult>> {
    const state = requireState(this);
    const binding = resolveBinding(state, session);
    const offset =
      typeof cursor === "string" && OPAQUE_CURSOR_PATTERN.test(cursor)
        ? binding?.cursorOffsets.get(cursor)
        : undefined;
    if (!binding || offset === undefined || binding.consumedCursors.has(cursor)) return STALE_PAGE;
    binding.consumedCursors.add(cursor);
    try {
      await reproveSession(state, binding, signal);
      return Object.freeze({
        kind: "loaded" as const,
        value: createPage(
          binding.outputs,
          binding.cursorOffsets as Map<string, number>,
          binding.semanticDigest,
          offset
        ),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      return error instanceof StaleSession ? STALE_PAGE : UNAVAILABLE_PAGE;
    }
  }

  /** Lazily returns one exact accepted output after full fresh reproof. */
  async readOutput(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    outputRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputDetailResult>> {
    const state = requireState(this);
    const binding = resolveBinding(state, session);
    const output =
      typeof outputRef === "string" && OPAQUE_OUTPUT_PATTERN.test(outputRef)
        ? binding?.outputByRef.get(outputRef)
        : undefined;
    if (!binding || !output) return STALE_DETAIL;
    try {
      const read = await readDetailSandwich(state, binding, output, signal);
      return Object.freeze({
        kind: "loaded" as const,
        value: Object.freeze({
          outputRef,
          appliedAt: output.item.newestAppliedAt,
          verifiedApplyCount: output.item.verifiedApplyCount,
          content: read.detail.content,
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (error instanceof StaleSession) return STALE_DETAIL;
      if (error instanceof TooLargeRead) return TOO_LARGE_DETAIL;
      return UNAVAILABLE_DETAIL;
    }
  }

  /** Returns exact known/current text without word-level diff or mutation. */
  async compareWithCurrent(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    outputRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputComparisonResult>> {
    const state = requireState(this);
    const binding = resolveBinding(state, session);
    const output =
      typeof outputRef === "string" && OPAQUE_OUTPUT_PATTERN.test(outputRef)
        ? binding?.outputByRef.get(outputRef)
        : undefined;
    if (!binding || !output) return STALE_COMPARISON;
    try {
      const read = await readDetailSandwich(state, binding, output, signal);
      if (read.observation.kind !== "file") return UNAVAILABLE_COMPARISON;
      return Object.freeze({
        kind: "loaded" as const,
        value: Object.freeze({
          outputRef,
          currentState: session.currentState,
          knownContent: read.detail.content,
          currentContent: read.observation.content,
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (error instanceof StaleSession) return STALE_COMPARISON;
      if (error instanceof TooLargeRead) return TOO_LARGE_COMPARISON;
      return UNAVAILABLE_COMPARISON;
    }
  }
}

Object.freeze(KnowledgeProductionKnownAppliedWikiOutputsCoordinator.prototype);
Object.freeze(KnowledgeProductionKnownAppliedWikiOutputsCoordinator);
