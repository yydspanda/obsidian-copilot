import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import type { CompilerSchemaSnapshot } from "@/knowledge/compiler/CompilerModelPort";
import {
  deriveKnowledgeSourceCompileAuthority,
  type KnowledgeSourceCompileAuthority,
  type KnowledgeSourceCompileOperation,
} from "@/knowledge/capture/KnowledgeSourceOrigin";
import {
  buildKnowledgeSourceWatchPlan,
  createKnowledgeSourceParserProfileDigest,
  type KnowledgeBundlePipelineProfile,
  type KnowledgeBundleWatchPlanInput,
  type KnowledgeSchemaSnapshot,
  type KnowledgeSourceParserProfile,
  KnowledgeSourceWatchPlan,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { ExactSourceArtifact } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import {
  canonicalizeJson,
  createFileContentHash,
  createSourceContentHash,
  isExactUint8Array,
} from "@/knowledge/model/fingerprint";
import type { SourceArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import { parseKnowledgeBundleConfig, parseSourceManifest } from "@/knowledge/model/schemas";
import type { JsonValue, KnowledgeBundleConfig, SourceManifest } from "@/knowledge/model/types";
import {
  type KnowledgeByteParser,
  type KnowledgeByteParserRequest,
  type KnowledgeParsedSource,
  verifyKnowledgeParsedSource,
} from "@/knowledge/parser/KnowledgeByteParser";
import { sha256 } from "@/utils/hash";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_MAX_SCHEMA_BYTES = 1_000_000;
const DEFAULT_MAX_PARSED_CHARACTERS = 8_000_000;
const MAX_WORKFLOW_ARRAY_LENGTH = 10_000;
const EXECUTION_PLAN_TOKEN = Symbol("KnowledgeSourceExecutionPlan.constructor");

export interface KnowledgeManifestSnapshotPort {
  load(bundleId: string): Promise<unknown>;
}

export interface KnowledgeExactArtifactReaderPort {
  read(sourcePath: string, signal?: AbortSignal): Promise<ExactSourceArtifact>;

  readExpected(
    sourcePath: string,
    expectedContentHash: string,
    signal?: AbortSignal
  ): Promise<ExactSourceArtifact>;
}

export interface KnowledgePipelineProfilePort {
  resolve(owner: ConfiguredProjectKnowledgeBundle, signal: AbortSignal): unknown;
}

export interface KnowledgeWorkflowGenerationPort {
  isCurrent(): boolean;
}

export interface KnowledgeSourceWorkflowPlanDependencies {
  executionOwner: KnowledgeExecutionOwner;
  manifest: KnowledgeManifestSnapshotPort;
  artifactReader: KnowledgeExactArtifactReaderPort;
  pipelineProfile: KnowledgePipelineProfilePort;
  parsers: readonly KnowledgeByteParser[];
  generation: KnowledgeWorkflowGenerationPort;
  maxSchemaBytes?: number;
  maxParsedCharacters?: number;
}

export interface KnowledgeSourceParseJob {
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
}

export interface KnowledgeUnboundSourceObservation {
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
}

export interface KnowledgeSourceParsePreparation {
  authority: "unbound_read_only";
  operation: KnowledgeSourceCompileOperation;
  bundle: KnowledgeBundleConfig;
  manifest: SourceManifest;
  schema: CompilerSchemaSnapshot;
  source: KnowledgeUnboundSourceObservation;
  artifacts: readonly SourceArtifactObservation[];
}

function requireMatchingSourceCompileAuthority(
  watchedSource: ReturnType<KnowledgeSourceWatchPlan["getSource"]>,
  manifestEntry: SourceManifest["entries"][number],
  sourceContentHash: string
): KnowledgeSourceCompileAuthority {
  if (!watchedSource) {
    throw new KnowledgeSourceWorkflowPlanError("job_not_authorized", "job");
  }
  let current: KnowledgeSourceCompileAuthority;
  try {
    current = deriveKnowledgeSourceCompileAuthority(manifestEntry);
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("manifest_stale", "manifest");
  }
  const retainedOperation =
    "operation" in watchedSource ? watchedSource.operation : ("ingest" as const);
  if (current.operation !== retainedOperation) {
    throw new KnowledgeSourceWorkflowPlanError("manifest_stale", "manifest");
  }
  if (current.operation === "query_writeback") {
    if (
      !("sourceOriginDigest" in watchedSource) ||
      current.sourceOriginDigest !== watchedSource.sourceOriginDigest ||
      current.expectedSourceContentHash !== watchedSource.expectedSourceContentHash ||
      current.expectedSourceContentHash !== sourceContentHash
    ) {
      throw new KnowledgeSourceWorkflowPlanError("manifest_stale", "manifest");
    }
  }
  return current;
}

export interface KnowledgeSourceBundleAuthoritySnapshot {
  readonly manifest: SourceManifest;
  readonly schema: CompilerSchemaSnapshot;
  readonly pipeline: KnowledgeBundlePipelineProfile;
}

export type KnowledgeSourceWorkflowPlanErrorStage =
  | "dependencies"
  | "bundle"
  | "manifest"
  | "schema"
  | "profile"
  | "plan"
  | "job"
  | "parser";

export type KnowledgeSourceWorkflowPlanErrorCode =
  | "dependency_invalid"
  | "generation_stale"
  | "bundle_invalid"
  | "manifest_invalid"
  | "manifest_stale"
  | "schema_invalid"
  | "schema_stale"
  | "schema_too_large"
  | "schema_utf8_invalid"
  | "profile_invalid"
  | "profile_stale"
  | "collection_changed"
  | "parser_binding_invalid"
  | "job_invalid"
  | "job_not_authorized"
  | "artifact_invalid"
  | "parser_mutated_bytes"
  | "plan_not_authoritative";

export class KnowledgeSourceWorkflowPlanError extends Error {
  constructor(
    public readonly code: KnowledgeSourceWorkflowPlanErrorCode,
    public readonly stage: KnowledgeSourceWorkflowPlanErrorStage,
    public readonly bundleIndex?: number
  ) {
    super("The knowledge source workflow plan could not be prepared");
    this.name = "KnowledgeSourceWorkflowPlanError";
  }
}

interface CapturedMethod {
  receiver: object;
  method: (...args: never[]) => unknown;
}

interface CapturedParser {
  profile: KnowledgeSourceParserProfile;
  profileDigest: string;
  parse: (request: Readonly<KnowledgeByteParserRequest>, signal: AbortSignal) => Promise<unknown>;
}

interface CollectedBundleMaterial {
  owner: ConfiguredProjectKnowledgeBundle;
  manifest: SourceManifest;
  schema: CompilerSchemaSnapshot;
  pipeline: KnowledgeBundlePipelineProfile;
}

interface CollectedWorkflowMaterial {
  watchPlan: KnowledgeSourceWatchPlan;
  bundles: readonly CollectedBundleMaterial[];
  digest: string;
}

interface ExecutionPlanState {
  executionOwner: KnowledgeExecutionOwner;
  watchPlan: KnowledgeSourceWatchPlan;
  bundlesById: ReadonlyMap<string, CollectedBundleMaterial>;
  parsersBySource: ReadonlyMap<string, CapturedParser>;
  manifestLoad: (bundleId: string) => Promise<unknown>;
  readArtifact: (sourcePath: string, signal?: AbortSignal) => Promise<ExactSourceArtifact>;
  readExpectedArtifact: (
    sourcePath: string,
    expectedContentHash: string,
    signal?: AbortSignal
  ) => Promise<ExactSourceArtifact>;
  resolveProfile: (
    owner: ConfiguredProjectKnowledgeBundle,
    signal: AbortSignal
  ) => Promise<unknown>;
  isCurrent: () => boolean;
  parsers: readonly CapturedParser[];
  maxSchemaBytes: number;
  maxParsedCharacters: number;
  digest: string;
}

interface WorkflowPlanLoaderState {
  dependencies: ReturnType<typeof captureDependencies>;
}

const executionPlanStates = new WeakMap<object, ExecutionPlanState>();
const workflowPlanLoaderStates = new WeakMap<object, WorkflowPlanLoaderState>();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createBundleSourceKey(bundleId: string, sourceId: string): string {
  return `${bundleId.length}:${bundleId}${sourceId.length}:${sourceId}`;
}

function createAbortError(): Error {
  const error = new Error("The knowledge source workflow operation was aborted");
  error.name = "AbortError";
  return error;
}

function assertCurrent(signal: AbortSignal, isCurrent: () => boolean): void {
  if (signal.aborted) {
    throw createAbortError();
  }
  assertGenerationCurrent(isCurrent);
}

function assertGenerationCurrent(isCurrent: () => boolean): void {
  let current = false;
  try {
    current = isCurrent();
  } catch {
    current = false;
  }
  if (!current) {
    throw new KnowledgeSourceWorkflowPlanError("generation_stale", "plan");
  }
}

function requirePositiveLimit(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function captureDataMethod(value: unknown, key: string): CapturedMethod | undefined {
  try {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
      return undefined;
    }
    const receiver = value;
    let owner: object | null = receiver;
    const visited = new Set<object>();
    while (owner) {
      if (owner === Object.prototype || visited.has(owner)) return undefined;
      visited.add(owner);
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "function"
          ? { receiver, method: descriptor.value as (...args: never[]) => unknown }
          : undefined;
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function snapshotExactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const expected = [...keys].sort(compareText);
    const actual = Reflect.ownKeys(value);
    if (
      actual.length !== expected.length ||
      actual.some((key) => typeof key !== "string") ||
      (actual as string[]).sort(compareText).some((key, index) => key !== expected[index])
    ) {
      return undefined;
    }
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function readOwnDataProperty(value: unknown, key: string): unknown {
  try {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
      throw new TypeError("Expected object");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Expected own data property");
    }
    return descriptor.value;
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
  }
}

function readOptionalOwnDataProperty(value: unknown, key: string): unknown {
  try {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
      throw new TypeError("Expected object");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Expected own data property");
    }
    return descriptor.value;
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
  }
}

function snapshotDenseArray(value: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_WORKFLOW_ARRAY_LENGTH ||
      Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
    ) {
      return undefined;
    }
    const snapshot: unknown[] = [];
    for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function snapshotJsonValue(
  value: unknown,
  ancestors: Set<object> = new Set<object>(),
  budget: { remaining: number } = { remaining: 100_000 }
): JsonValue {
  budget.remaining -= 1;
  if (budget.remaining < 0) throw new TypeError("JSON snapshot limit exceeded");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Expected finite JSON number");
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new TypeError("Expected acyclic JSON data");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > MAX_WORKFLOW_ARRAY_LENGTH ||
        Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
      ) {
        throw new TypeError("Expected dense JSON array");
      }
      const result = new Array<JsonValue>(lengthDescriptor.value as number);
      for (let index = 0; index < result.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError("Expected JSON array data property");
        }
        result[index] = snapshotJsonValue(descriptor.value, ancestors, budget);
      }
      Object.freeze(result);
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Expected plain JSON object");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("Expected string JSON keys");
    }
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of (keys as string[]).sort(compareText)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Expected JSON object data property");
      }
      Object.defineProperty(result, key, {
        value: snapshotJsonValue(descriptor.value, ancestors, budget),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function captureBundleOwners(value: unknown): readonly ConfiguredProjectKnowledgeBundle[] {
  let snapshot: JsonValue;
  try {
    snapshot = snapshotJsonValue(value);
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("bundle_invalid", "bundle");
  }
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    throw new KnowledgeSourceWorkflowPlanError("bundle_invalid", "bundle");
  }
  const owners: ConfiguredProjectKnowledgeBundle[] = [];
  for (let bundleIndex = 0; bundleIndex < snapshot.length; bundleIndex += 1) {
    const owner = snapshotExactRecord(snapshot[bundleIndex], ["projectId", "config"]);
    if (
      !owner ||
      typeof owner.projectId !== "string" ||
      owner.projectId.length === 0 ||
      owner.projectId.trim() !== owner.projectId
    ) {
      throw new KnowledgeSourceWorkflowPlanError("bundle_invalid", "bundle", bundleIndex);
    }
    const parsed = parseKnowledgeBundleConfig(owner.config);
    if (!parsed.ok) {
      throw new KnowledgeSourceWorkflowPlanError("bundle_invalid", "bundle", bundleIndex);
    }
    const config = snapshotJsonValue(parsed.value) as unknown as KnowledgeBundleConfig;
    owners.push(Object.freeze({ projectId: owner.projectId, config }));
  }
  owners.sort(
    (left, right) =>
      compareText(left.config.id, right.config.id) || compareText(left.projectId, right.projectId)
  );
  return Object.freeze(owners);
}

function haveEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function copyExactBytes(value: Uint8Array): Uint8Array {
  const copy = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    copy[index] = value[index];
  }
  return copy;
}

function assertParserBytesUnchanged(bytes: Uint8Array, expectedHash: string): void {
  if (createSourceContentHash(bytes) !== expectedHash) {
    throw new KnowledgeSourceWorkflowPlanError("parser_mutated_bytes", "parser");
  }
}

function decodeSchema(
  bytes: Uint8Array,
  path: string,
  maxSchemaBytes: number,
  bundleIndex?: number
): CompilerSchemaSnapshot {
  if (bytes.length > maxSchemaBytes) {
    throw new KnowledgeSourceWorkflowPlanError("schema_too_large", "schema", bundleIndex);
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("schema_utf8_invalid", "schema", bundleIndex);
  }
  if (!haveEqualBytes(new TextEncoder().encode(content), bytes) || content.trim().length === 0) {
    throw new KnowledgeSourceWorkflowPlanError("schema_utf8_invalid", "schema", bundleIndex);
  }
  return Object.freeze({ path, content, contentHash: createFileContentHash(content) });
}

function verifyExactArtifact(
  value: unknown,
  expectedPath: string,
  expectedHash?: string,
  code: "schema_invalid" | "schema_stale" | "artifact_invalid" = "artifact_invalid",
  bundleIndex?: number
): ExactSourceArtifact {
  const snapshot = snapshotExactRecord(value, ["sourcePath", "bytes", "sourceContentHash"]);
  if (
    !snapshot ||
    snapshot.sourcePath !== expectedPath ||
    !isExactUint8Array(snapshot.bytes) ||
    typeof snapshot.sourceContentHash !== "string" ||
    !SHA256_PATTERN.test(snapshot.sourceContentHash)
  ) {
    throw new KnowledgeSourceWorkflowPlanError(
      code,
      code.startsWith("schema") ? "schema" : "job",
      bundleIndex
    );
  }
  const actualHash = createSourceContentHash(snapshot.bytes);
  if (actualHash !== snapshot.sourceContentHash || (expectedHash && actualHash !== expectedHash)) {
    throw new KnowledgeSourceWorkflowPlanError(
      code,
      code.startsWith("schema") ? "schema" : "job",
      bundleIndex
    );
  }
  return Object.freeze({
    sourcePath: expectedPath,
    bytes: snapshot.bytes,
    sourceContentHash: actualHash,
  });
}

function captureParser(value: KnowledgeByteParser): CapturedParser {
  const getProfile = captureDataMethod(value, "getProfile");
  const parse = captureDataMethod(value, "parse");
  if (!getProfile || !parse) {
    throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
  }
  let profileValue: unknown;
  try {
    profileValue = Reflect.apply(getProfile.method, getProfile.receiver, []);
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
  }
  let snapshot: JsonValue;
  try {
    snapshot = snapshotJsonValue(profileValue);
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
  }
  const profile = snapshotExactRecord(snapshot, ["id", "version", "pathSuffixes", "configuration"]);
  if (
    !profile ||
    typeof profile.id !== "string" ||
    typeof profile.version !== "string" ||
    !Array.isArray(profile.pathSuffixes)
  ) {
    throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
  }
  const typedProfile = profile as unknown as KnowledgeSourceParserProfile;
  let profileDigest: string;
  try {
    profileDigest = createKnowledgeSourceParserProfileDigest(typedProfile);
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
  }
  return Object.freeze({
    profile: typedProfile,
    profileDigest,
    parse: async (
      request: Readonly<KnowledgeByteParserRequest>,
      signal: AbortSignal
    ): Promise<unknown> =>
      (await Reflect.apply(parse.method, parse.receiver, [request, signal])) as unknown,
  });
}

function capturePipelineProfile(
  value: unknown,
  parsers: readonly CapturedParser[],
  bundleIndex?: number
): KnowledgeBundlePipelineProfile {
  let snapshot: JsonValue;
  try {
    snapshot = snapshotJsonValue(value);
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("profile_invalid", "profile", bundleIndex);
  }
  const profile = snapshotExactRecord(snapshot, [
    "version",
    "bundleId",
    "compiler",
    "parsers",
    "model",
    "outputLanguage",
    "okfVersion",
    "citationContractVersion",
  ]);
  if (!profile || !Array.isArray(profile.parsers) || profile.parsers.length === 0) {
    throw new KnowledgeSourceWorkflowPlanError("profile_invalid", "profile", bundleIndex);
  }
  let profileDigests: string[];
  try {
    profileDigests = profile.parsers.map((parser) =>
      createKnowledgeSourceParserProfileDigest(parser as KnowledgeSourceParserProfile)
    );
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("profile_invalid", "profile", bundleIndex);
  }
  const capturedDigests = parsers.map(({ profileDigest }) => profileDigest).sort(compareText);
  profileDigests.sort(compareText);
  if (
    profileDigests.length !== capturedDigests.length ||
    profileDigests.some((digest, index) => digest !== capturedDigests[index])
  ) {
    throw new KnowledgeSourceWorkflowPlanError("parser_binding_invalid", "profile", bundleIndex);
  }
  return snapshot as unknown as KnowledgeBundlePipelineProfile;
}

function captureDependencies(dependencies: KnowledgeSourceWorkflowPlanDependencies): {
  executionOwner: KnowledgeExecutionOwner;
  manifestLoad: (bundleId: string) => Promise<unknown>;
  readArtifact: (path: string, signal?: AbortSignal) => Promise<ExactSourceArtifact>;
  readExpectedArtifact: (
    path: string,
    hash: string,
    signal?: AbortSignal
  ) => Promise<ExactSourceArtifact>;
  resolveProfile: (
    owner: ConfiguredProjectKnowledgeBundle,
    signal: AbortSignal
  ) => Promise<unknown>;
  isCurrent: () => boolean;
  parsers: readonly CapturedParser[];
  maxSchemaBytes: number;
  maxParsedCharacters: number;
} {
  const executionOwner = readOwnDataProperty(dependencies, "executionOwner");
  try {
    KnowledgeExecutionOwner.assert(executionOwner);
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
  }
  const manifest = readOwnDataProperty(dependencies, "manifest");
  const artifactReader = readOwnDataProperty(dependencies, "artifactReader");
  const pipelineProfile = readOwnDataProperty(dependencies, "pipelineProfile");
  const generation = readOwnDataProperty(dependencies, "generation");
  const parserValues = snapshotDenseArray(readOwnDataProperty(dependencies, "parsers"));
  const manifestLoad = captureDataMethod(manifest, "load");
  const readArtifact = captureDataMethod(artifactReader, "read");
  const readExpectedArtifact = captureDataMethod(artifactReader, "readExpected");
  const resolveProfile = captureDataMethod(pipelineProfile, "resolve");
  const isCurrent = captureDataMethod(generation, "isCurrent");
  if (!manifestLoad || !readArtifact || !readExpectedArtifact || !resolveProfile || !isCurrent) {
    throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
  }
  if (!parserValues) {
    throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
  }
  const parsers = parserValues.map((parser) => captureParser(parser as KnowledgeByteParser));
  if (
    parsers.length === 0 ||
    new Set(parsers.map(({ profileDigest }) => profileDigest)).size !== parsers.length
  ) {
    throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
  }
  const maxSchemaBytes = readOptionalOwnDataProperty(dependencies, "maxSchemaBytes");
  const maxParsedCharacters = readOptionalOwnDataProperty(dependencies, "maxParsedCharacters");
  return Object.freeze({
    executionOwner,
    manifestLoad: async (bundleId) =>
      (await Reflect.apply(manifestLoad.method, manifestLoad.receiver, [bundleId])) as unknown,
    readArtifact: async (path, signal) =>
      (await Reflect.apply(readArtifact.method, readArtifact.receiver, [
        path,
        signal,
      ])) as ExactSourceArtifact,
    readExpectedArtifact: async (path, hash, signal) =>
      (await Reflect.apply(readExpectedArtifact.method, readExpectedArtifact.receiver, [
        path,
        hash,
        signal,
      ])) as ExactSourceArtifact,
    resolveProfile: async (owner, signal) =>
      (await Reflect.apply(resolveProfile.method, resolveProfile.receiver, [
        owner,
        signal,
      ])) as unknown,
    isCurrent: () => Reflect.apply(isCurrent.method, isCurrent.receiver, []) === true,
    parsers: Object.freeze(parsers),
    maxSchemaBytes: requirePositiveLimit(
      (maxSchemaBytes as number | undefined) ?? DEFAULT_MAX_SCHEMA_BYTES,
      "maxSchemaBytes"
    ),
    maxParsedCharacters: requirePositiveLimit(
      (maxParsedCharacters as number | undefined) ?? DEFAULT_MAX_PARSED_CHARACTERS,
      "maxParsedCharacters"
    ),
  });
}

function parseManifestSnapshot(
  value: unknown,
  bundleId: string,
  bundleIndex?: number
): SourceManifest {
  let snapshot: JsonValue;
  try {
    snapshot = snapshotJsonValue(value);
  } catch {
    throw new KnowledgeSourceWorkflowPlanError("manifest_invalid", "manifest", bundleIndex);
  }
  const parsed = parseSourceManifest(snapshot);
  if (!parsed.ok || parsed.value.bundleId !== bundleId) {
    throw new KnowledgeSourceWorkflowPlanError("manifest_invalid", "manifest", bundleIndex);
  }
  return snapshotJsonValue(parsed.value) as unknown as SourceManifest;
}

async function loadSchemaMaterial(
  owner: ConfiguredProjectKnowledgeBundle,
  readArtifact: (path: string, signal?: AbortSignal) => Promise<ExactSourceArtifact>,
  signal: AbortSignal,
  isCurrent: () => boolean,
  maxSchemaBytes: number,
  bundleIndex?: number
): Promise<{ snapshot: KnowledgeSchemaSnapshot; compiler: CompilerSchemaSnapshot }> {
  assertCurrent(signal, isCurrent);
  let raw: unknown;
  try {
    raw = await readArtifact(owner.config.schemaRef, signal);
  } catch {
    assertCurrent(signal, isCurrent);
    throw new KnowledgeSourceWorkflowPlanError("schema_invalid", "schema", bundleIndex);
  }
  assertCurrent(signal, isCurrent);
  const artifact = verifyExactArtifact(
    raw,
    owner.config.schemaRef,
    undefined,
    "schema_invalid",
    bundleIndex
  );
  const bytes = copyExactBytes(artifact.bytes);
  if (createSourceContentHash(bytes) !== artifact.sourceContentHash) {
    throw new KnowledgeSourceWorkflowPlanError("schema_invalid", "schema", bundleIndex);
  }
  return {
    snapshot: { path: owner.config.schemaRef, bytes },
    compiler: decodeSchema(bytes, owner.config.schemaRef, maxSchemaBytes, bundleIndex),
  };
}

function requireExecutionPlanState(value: unknown): ExecutionPlanState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeSourceWorkflowPlanError("plan_not_authoritative", "plan");
  }
  const state = executionPlanStates.get(value);
  if (!state) {
    throw new KnowledgeSourceWorkflowPlanError("plan_not_authoritative", "plan");
  }
  return state;
}

function requireWorkflowPlanLoaderState(value: unknown): WorkflowPlanLoaderState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeSourceWorkflowPlanError("plan_not_authoritative", "plan");
  }
  const state = workflowPlanLoaderStates.get(value);
  if (!state) {
    throw new KnowledgeSourceWorkflowPlanError("plan_not_authoritative", "plan");
  }
  return state;
}

function parseJob(value: unknown): KnowledgeSourceParseJob {
  const snapshot = snapshotExactRecord(value, [
    "bundleId",
    "sourceId",
    "sourceContentHash",
    "pipelineFingerprint",
    "inputRevision",
  ]);
  if (
    !snapshot ||
    typeof snapshot.bundleId !== "string" ||
    snapshot.bundleId.trim() !== snapshot.bundleId ||
    snapshot.bundleId.length === 0 ||
    typeof snapshot.sourceId !== "string" ||
    snapshot.sourceId.trim() !== snapshot.sourceId ||
    snapshot.sourceId.length === 0 ||
    typeof snapshot.sourceContentHash !== "string" ||
    !SHA256_PATTERN.test(snapshot.sourceContentHash) ||
    typeof snapshot.pipelineFingerprint !== "string" ||
    !SHA256_PATTERN.test(snapshot.pipelineFingerprint) ||
    !Number.isSafeInteger(snapshot.inputRevision) ||
    (snapshot.inputRevision as number) < 1
  ) {
    throw new KnowledgeSourceWorkflowPlanError("job_invalid", "job");
  }
  return Object.freeze({
    bundleId: snapshot.bundleId,
    sourceId: snapshot.sourceId,
    sourceContentHash: snapshot.sourceContentHash,
    pipelineFingerprint: snapshot.pipelineFingerprint,
    inputRevision: snapshot.inputRevision as number,
  });
}

async function reproveManifest(
  state: ExecutionPlanState,
  bundleId: string,
  signal: AbortSignal
): Promise<SourceManifest> {
  assertCurrent(signal, state.isCurrent);
  let raw: unknown;
  try {
    raw = await state.manifestLoad(bundleId);
  } catch {
    assertCurrent(signal, state.isCurrent);
    throw new KnowledgeSourceWorkflowPlanError("manifest_stale", "manifest");
  }
  assertCurrent(signal, state.isCurrent);
  const manifest = parseManifestSnapshot(raw, bundleId);
  const authority = state.watchPlan.getBundleAuthority(bundleId);
  if (
    !authority ||
    manifest.revision !== authority.manifestRevision ||
    createSourceManifestDigest(manifest) !== authority.manifestDigest
  ) {
    throw new KnowledgeSourceWorkflowPlanError("manifest_stale", "manifest");
  }
  return manifest;
}

async function reproveSchema(
  state: ExecutionPlanState,
  material: CollectedBundleMaterial,
  signal: AbortSignal
): Promise<void> {
  assertCurrent(signal, state.isCurrent);
  let raw: unknown;
  try {
    raw = await state.readArtifact(material.owner.config.schemaRef, signal);
  } catch {
    assertCurrent(signal, state.isCurrent);
    throw new KnowledgeSourceWorkflowPlanError("schema_stale", "schema");
  }
  assertCurrent(signal, state.isCurrent);
  const authority = state.watchPlan.getBundleAuthority(material.owner.config.id);
  if (!authority) {
    throw new KnowledgeSourceWorkflowPlanError("schema_stale", "schema");
  }
  const artifact = verifyExactArtifact(
    raw,
    material.owner.config.schemaRef,
    authority.schemaContentHash,
    "schema_stale"
  );
  const compiler = decodeSchema(
    artifact.bytes,
    material.owner.config.schemaRef,
    state.maxSchemaBytes
  );
  if (
    compiler.contentHash !== material.schema.contentHash ||
    compiler.content !== material.schema.content
  ) {
    throw new KnowledgeSourceWorkflowPlanError("schema_stale", "schema");
  }
}

async function reprovePipelineProfile(
  state: ExecutionPlanState,
  material: CollectedBundleMaterial,
  signal: AbortSignal
): Promise<void> {
  assertCurrent(signal, state.isCurrent);
  let profileValue: unknown;
  try {
    profileValue = await state.resolveProfile(material.owner, signal);
    assertCurrent(signal, state.isCurrent);
    const profile = capturePipelineProfile(profileValue, state.parsers);
    if (
      canonicalizeJson(profile as unknown as JsonValue) !==
      canonicalizeJson(material.pipeline as unknown as JsonValue)
    ) {
      throw new TypeError("Pipeline profile changed");
    }
  } catch {
    assertCurrent(signal, state.isCurrent);
    throw new KnowledgeSourceWorkflowPlanError("profile_stale", "profile");
  }
  assertCurrent(signal, state.isCurrent);
}

async function reproveBundleMaterial(
  state: ExecutionPlanState,
  material: CollectedBundleMaterial,
  signal: AbortSignal
): Promise<Readonly<KnowledgeSourceBundleAuthoritySnapshot>> {
  const manifest = await reproveManifest(state, material.owner.config.id, signal);
  await reproveSchema(state, material, signal);
  await reprovePipelineProfile(state, material, signal);
  assertCurrent(signal, state.isCurrent);
  return Object.freeze({
    manifest,
    schema: material.schema,
    pipeline: material.pipeline,
  });
}

export class KnowledgeSourceExecutionPlan {
  private constructor(token: symbol, state: ExecutionPlanState) {
    if (token !== EXECUTION_PLAN_TOKEN) {
      throw new KnowledgeSourceWorkflowPlanError("plan_not_authoritative", "plan");
    }
    executionPlanStates.set(this, state);
    Object.freeze(this);
  }

  static create(token: symbol, state: ExecutionPlanState): KnowledgeSourceExecutionPlan {
    if (token !== EXECUTION_PLAN_TOKEN) {
      throw new KnowledgeSourceWorkflowPlanError("plan_not_authoritative", "plan");
    }
    return new KnowledgeSourceExecutionPlan(EXECUTION_PLAN_TOKEN, state);
  }

  static assert(value: unknown): asserts value is KnowledgeSourceExecutionPlan {
    requireExecutionPlanState(value);
  }

  getWatchPlan(): KnowledgeSourceWatchPlan {
    const state = requireExecutionPlanState(this);
    assertGenerationCurrent(state.isCurrent);
    return state.watchPlan;
  }

  getDigest(): string {
    const state = requireExecutionPlanState(this);
    assertGenerationCurrent(state.isCurrent);
    return state.digest;
  }

  matchesExecutionOwner(value: unknown): boolean {
    const state = requireExecutionPlanState(this);
    assertGenerationCurrent(state.isCurrent);
    try {
      KnowledgeExecutionOwner.assert(value);
      return state.executionOwner === value;
    } catch {
      return false;
    }
  }

  getBundlePipelineProfile(bundleId: string): KnowledgeBundlePipelineProfile | undefined {
    const state = requireExecutionPlanState(this);
    assertGenerationCurrent(state.isCurrent);
    return state.bundlesById.get(bundleId)?.pipeline;
  }

  async reproveBundleAuthorities(
    bundleId: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceBundleAuthoritySnapshot>> {
    const state = requireExecutionPlanState(this);
    assertCurrent(signal, state.isCurrent);
    const material = state.bundlesById.get(bundleId);
    if (!material) {
      throw new KnowledgeSourceWorkflowPlanError("job_not_authorized", "job");
    }
    return reproveBundleMaterial(state, material, signal);
  }

  async prepare(
    jobValue: KnowledgeSourceParseJob,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeSourceParsePreparation>> {
    const state = requireExecutionPlanState(this);
    const job = parseJob(jobValue);
    assertCurrent(signal, state.isCurrent);
    const source = state.watchPlan.getSource(job.bundleId, job.sourceId);
    const material = state.bundlesById.get(job.bundleId);
    const parser = state.parsersBySource.get(createBundleSourceKey(job.bundleId, job.sourceId));
    if (!source || !material || !parser || source.pipelineFingerprint !== job.pipelineFingerprint) {
      throw new KnowledgeSourceWorkflowPlanError("job_not_authorized", "job");
    }

    const initialAuthority = await reproveBundleMaterial(state, material, signal);
    const manifest = initialAuthority.manifest;
    const manifestSource = manifest.entries.find((entry) => entry.sourceId === job.sourceId);
    if (
      !manifestSource ||
      manifestSource.sourcePath !== source.sourcePath ||
      manifestSource.sourceKey !== source.sourceKey
    ) {
      throw new KnowledgeSourceWorkflowPlanError("manifest_stale", "manifest");
    }
    const sourceCompileAuthority = requireMatchingSourceCompileAuthority(
      source,
      manifestSource,
      job.sourceContentHash
    );
    let rawArtifact: unknown;
    try {
      rawArtifact = await state.readExpectedArtifact(
        source.sourcePath,
        job.sourceContentHash,
        signal
      );
    } catch {
      assertCurrent(signal, state.isCurrent);
      throw new KnowledgeSourceWorkflowPlanError("artifact_invalid", "job");
    }
    assertCurrent(signal, state.isCurrent);
    const artifact = verifyExactArtifact(
      rawArtifact,
      source.sourcePath,
      job.sourceContentHash,
      "artifact_invalid"
    );
    const parserRequest = Object.freeze({
      sourceId: source.sourceId,
      sourcePath: source.sourcePath,
      sourceContentHash: artifact.sourceContentHash,
      bytes: artifact.bytes,
    });
    const hashBeforeParse = createSourceContentHash(artifact.bytes);

    let parsedValue: unknown;
    try {
      parsedValue = await parser.parse(parserRequest, signal);
    } catch {
      assertCurrent(signal, state.isCurrent);
      assertParserBytesUnchanged(artifact.bytes, hashBeforeParse);
      throw new KnowledgeSourceWorkflowPlanError("artifact_invalid", "parser");
    }
    assertCurrent(signal, state.isCurrent);
    assertParserBytesUnchanged(artifact.bytes, hashBeforeParse);
    let parsed: Readonly<KnowledgeParsedSource>;
    try {
      parsed = verifyKnowledgeParsedSource(parsedValue, parserRequest, state.maxParsedCharacters);
    } catch {
      assertParserBytesUnchanged(artifact.bytes, hashBeforeParse);
      throw new KnowledgeSourceWorkflowPlanError("artifact_invalid", "parser");
    }
    assertParserBytesUnchanged(artifact.bytes, hashBeforeParse);

    const finalAuthority = await reproveBundleMaterial(state, material, signal);
    assertCurrent(signal, state.isCurrent);
    assertParserBytesUnchanged(artifact.bytes, hashBeforeParse);
    const finalManifestSource = finalAuthority.manifest.entries.find(
      (entry) => entry.sourceId === job.sourceId
    );
    if (
      !finalManifestSource ||
      finalManifestSource.sourcePath !== source.sourcePath ||
      finalManifestSource.sourceKey !== source.sourceKey
    ) {
      throw new KnowledgeSourceWorkflowPlanError("manifest_stale", "manifest");
    }
    const finalSourceCompileAuthority = requireMatchingSourceCompileAuthority(
      source,
      finalManifestSource,
      job.sourceContentHash
    );
    if (finalSourceCompileAuthority.operation !== sourceCompileAuthority.operation) {
      throw new KnowledgeSourceWorkflowPlanError("manifest_stale", "manifest");
    }
    const sourceIdentity = Object.freeze({
      sourceId: job.sourceId,
      sourceContentHash: job.sourceContentHash,
      pipelineFingerprint: job.pipelineFingerprint,
      inputRevision: job.inputRevision,
    });
    return Object.freeze({
      authority: "unbound_read_only" as const,
      operation: sourceCompileAuthority.operation,
      bundle: material.owner.config,
      manifest: finalAuthority.manifest,
      schema: material.schema,
      source: sourceIdentity,
      artifacts: Object.freeze([parsed.artifact]),
    });
  }
}

Object.freeze(KnowledgeSourceExecutionPlan.prototype);
Object.freeze(KnowledgeSourceExecutionPlan);

export class KnowledgeSourceWorkflowPlanLoader {
  constructor(dependencies: KnowledgeSourceWorkflowPlanDependencies) {
    const captured = captureDependencies(dependencies);
    try {
      KnowledgeExecutionOwner.bindWorkflow(captured.executionOwner, this);
    } catch {
      throw new KnowledgeSourceWorkflowPlanError("dependency_invalid", "dependencies");
    }
    workflowPlanLoaderStates.set(this, Object.freeze({ dependencies: captured }));
    Object.freeze(this);
  }

  private async collect(
    owners: readonly ConfiguredProjectKnowledgeBundle[],
    signal: AbortSignal
  ): Promise<CollectedWorkflowMaterial> {
    const { dependencies } = requireWorkflowPlanLoaderState(this);
    assertCurrent(signal, dependencies.isCurrent);
    const inputs: KnowledgeBundleWatchPlanInput[] = [];
    const bundles: CollectedBundleMaterial[] = [];
    for (let bundleIndex = 0; bundleIndex < owners.length; bundleIndex += 1) {
      const owner = owners[bundleIndex];
      assertCurrent(signal, dependencies.isCurrent);
      let manifestRaw: unknown;
      try {
        manifestRaw = await dependencies.manifestLoad(owner.config.id);
      } catch {
        assertCurrent(signal, dependencies.isCurrent);
        throw new KnowledgeSourceWorkflowPlanError("manifest_invalid", "manifest", bundleIndex);
      }
      assertCurrent(signal, dependencies.isCurrent);
      const manifest = parseManifestSnapshot(manifestRaw, owner.config.id, bundleIndex);
      const schema = await loadSchemaMaterial(
        owner,
        dependencies.readArtifact,
        signal,
        dependencies.isCurrent,
        dependencies.maxSchemaBytes,
        bundleIndex
      );
      let pipeline: unknown;
      try {
        pipeline = await dependencies.resolveProfile(owner, signal);
      } catch {
        assertCurrent(signal, dependencies.isCurrent);
        throw new KnowledgeSourceWorkflowPlanError("profile_invalid", "profile", bundleIndex);
      }
      assertCurrent(signal, dependencies.isCurrent);
      const pipelineSnapshot = capturePipelineProfile(pipeline, dependencies.parsers, bundleIndex);
      inputs.push({
        bundle: owner.config,
        manifest,
        schema: schema.snapshot,
        pipeline: pipelineSnapshot,
      });
      bundles.push(
        Object.freeze({ owner, manifest, schema: schema.compiler, pipeline: pipelineSnapshot })
      );
    }

    let watchPlan: KnowledgeSourceWatchPlan;
    try {
      watchPlan = buildKnowledgeSourceWatchPlan(inputs);
    } catch {
      throw new KnowledgeSourceWorkflowPlanError("profile_invalid", "plan");
    }
    const digest = sha256(
      `knowledge-source-workflow-collection-v1\n${canonicalizeJson({
        watchPlanDigest: watchPlan.getDigest(),
        owners: bundles.map(({ owner, schema }) => ({
          bundleId: owner.config.id,
          projectId: owner.projectId,
          compilerSchemaHash: schema.contentHash,
        })),
      })}`
    );
    return Object.freeze({ watchPlan, bundles: Object.freeze(bundles), digest });
  }

  async load(
    owners: readonly ConfiguredProjectKnowledgeBundle[],
    signal: AbortSignal
  ): Promise<KnowledgeSourceExecutionPlan> {
    const { dependencies } = requireWorkflowPlanLoaderState(this);
    const capturedOwners = captureBundleOwners(owners);
    const first = await this.collect(capturedOwners, signal);
    const second = await this.collect(capturedOwners, signal);
    assertCurrent(signal, dependencies.isCurrent);
    if (first.digest !== second.digest) {
      throw new KnowledgeSourceWorkflowPlanError("collection_changed", "plan");
    }

    const parsersByDigest = new Map(
      dependencies.parsers.map((parser) => [parser.profileDigest, parser])
    );
    const parsersBySource = new Map<string, CapturedParser>();
    for (const source of second.watchPlan.getSources()) {
      const authority = second.watchPlan.getSourceParserAuthority(source.bundleId, source.sourceId);
      const parser = authority ? parsersByDigest.get(authority.parserProfileDigest) : undefined;
      if (
        !authority ||
        !parser ||
        parser.profile.id !== authority.parserId ||
        parser.profile.version !== authority.parserVersion
      ) {
        throw new KnowledgeSourceWorkflowPlanError("parser_binding_invalid", "plan");
      }
      parsersBySource.set(createBundleSourceKey(source.bundleId, source.sourceId), parser);
    }
    const state: ExecutionPlanState = Object.freeze({
      executionOwner: dependencies.executionOwner,
      watchPlan: second.watchPlan,
      bundlesById: new Map(
        second.bundles.map((bundle) => [bundle.owner.config.id, bundle] as const)
      ),
      parsersBySource,
      manifestLoad: dependencies.manifestLoad,
      readArtifact: dependencies.readArtifact,
      readExpectedArtifact: dependencies.readExpectedArtifact,
      resolveProfile: dependencies.resolveProfile,
      isCurrent: dependencies.isCurrent,
      parsers: dependencies.parsers,
      maxSchemaBytes: dependencies.maxSchemaBytes,
      maxParsedCharacters: dependencies.maxParsedCharacters,
      digest: second.digest,
    });
    return KnowledgeSourceExecutionPlan.create(EXECUTION_PLAN_TOKEN, state);
  }
}

Object.freeze(KnowledgeSourceWorkflowPlanLoader.prototype);
Object.freeze(KnowledgeSourceWorkflowPlanLoader);
