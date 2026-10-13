import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import {
  projectKnowledgeEffectiveManifestPages,
  type KnowledgeEffectivePageOrigin,
} from "@/knowledge/manifest/KnowledgeEffectivePageProjection";
import {
  deriveKnowledgeSourceCompileAuthority,
  type KnowledgeSourceCompileOperation,
} from "@/knowledge/capture/KnowledgeSourceOrigin";
import {
  assertKnowledgeConfigurationContainsNoSecrets,
  canonicalizeJson,
  createKnowledgeBundleConfigDigest,
  createPipelineFingerprint,
  createSourceContentHash,
  isExactUint8Array,
} from "@/knowledge/model/fingerprint";
import { parseKnowledgeBundleConfig, parseSourceManifest } from "@/knowledge/model/schemas";
import type {
  GeneratedPageOwnership,
  JsonValue,
  KnowledgeBundleConfig,
  PipelineFingerprintInput,
  SourceManifest,
} from "@/knowledge/model/types";
import { KNOWLEDGE_CONTRACT_VERSION, SUPPORTED_OKF_VERSION } from "@/knowledge/model/types";
import { validateSourceManifestForBundle } from "@/knowledge/model/validation";
import { isPathWithinRoot, parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

export const KNOWLEDGE_PIPELINE_PROFILE_VERSION = 1 as const;

export const KNOWLEDGE_CITATION_CONTRACT_VERSION = 1 as const;

export interface KnowledgeSourceParserProfile {
  id: string;
  version: string;
  pathSuffixes: readonly string[];
  configuration: JsonValue;
}

export interface KnowledgeBundlePipelineProfile {
  version: typeof KNOWLEDGE_PIPELINE_PROFILE_VERSION;
  bundleId: string;
  compiler: {
    version: string;
    configuration: JsonValue;
  };
  parsers: readonly KnowledgeSourceParserProfile[];
  model: {
    provider: string;
    model: string;
    configuration: JsonValue;
  };
  outputLanguage: string;
  okfVersion: typeof SUPPORTED_OKF_VERSION;
  citationContractVersion: typeof KNOWLEDGE_CITATION_CONTRACT_VERSION;
}

export interface KnowledgeSchemaSnapshot {
  path: string;
  bytes: Uint8Array;
}

export interface KnowledgeBundleWatchPlanInput {
  bundle: KnowledgeBundleConfig;
  manifest: SourceManifest;
  schema: KnowledgeSchemaSnapshot;
  pipeline: KnowledgeBundlePipelineProfile;
}

interface WatchedKnowledgeSourceBase {
  bundleId: string;
  sourceId: string;
  sourcePath: string;
  sourceKey: string;
  pipelineFingerprint: string;
}

export type WatchedKnowledgeIngestSource = WatchedKnowledgeSourceBase;

export interface WatchedKnowledgeQueryWritebackSource extends WatchedKnowledgeSourceBase {
  operation: "query_writeback";
  sourceOriginDigest: string;
  expectedSourceContentHash: string;
}

export type WatchedKnowledgeSource =
  | WatchedKnowledgeIngestSource
  | WatchedKnowledgeQueryWritebackSource;

export interface WatchedKnowledgeGeneratedOutput {
  bundleId: string;
  outputPath: string;
  outputKey: string;
  ownership: GeneratedPageOwnership;
  sourceAppliedContentHash: string;
  effectiveContentHash: string;
  contentHash: string;
  origin: Readonly<KnowledgeEffectivePageOrigin>;
  sourceIds: readonly string[];
}

export interface KnowledgeSourceParserAuthority {
  bundleId: string;
  sourceId: string;
  parserId: string;
  parserVersion: string;
  parserProfileDigest: string;
}

export interface KnowledgeBundleWatchAuthority {
  bundleId: string;
  bundleConfigDigest: string;
  manifestRevision: number;
  manifestDigest: string;
  schemaContentHash: string;
  pipelineProfileDigest: string;
  sourceCount: number;
}

export type KnowledgeSourceWatchPlanBuildErrorCode =
  | "input_invalid"
  | "bundle_invalid"
  | "manifest_invalid"
  | "manifest_bundle_invalid"
  | "schema_snapshot_invalid"
  | "pipeline_profile_invalid"
  | "parser_registry_invalid"
  | "source_parser_missing"
  | "source_parser_ambiguous"
  | "source_origin_invalid"
  | "generated_output_invalid"
  | "generated_output_collision"
  | "bundle_id_duplicate"
  | "bundle_boundary_conflict"
  | "schema_snapshot_conflict"
  | "plan_not_authoritative";

export class KnowledgeSourceWatchPlanBuildError extends TypeError {
  readonly code: KnowledgeSourceWatchPlanBuildErrorCode;

  readonly bundleIndex?: number;

  readonly sourceIndex?: number;

  readonly parserIndex?: number;

  constructor(
    code: KnowledgeSourceWatchPlanBuildErrorCode,
    location: { bundleIndex?: number; sourceIndex?: number; parserIndex?: number } = {}
  ) {
    super("The knowledge source watch plan could not be built");
    this.name = "KnowledgeSourceWatchPlanBuildError";
    this.code = code;
    this.bundleIndex = location.bundleIndex;
    this.sourceIndex = location.sourceIndex;
    this.parserIndex = location.parserIndex;
  }
}

type ImmutableWatchedKnowledgeSource = Readonly<WatchedKnowledgeSource>;
type ImmutableWatchedKnowledgeGeneratedOutput = Readonly<WatchedKnowledgeGeneratedOutput>;
type ImmutableBundleWatchAuthority = Readonly<KnowledgeBundleWatchAuthority>;
type ImmutableSourceParserAuthority = Readonly<KnowledgeSourceParserAuthority>;

interface NormalizedParserProfile {
  id: string;
  version: string;
  pathSuffixes: readonly string[];
  configuration: JsonValue;
}

interface NormalizedPipelineProfile {
  version: typeof KNOWLEDGE_PIPELINE_PROFILE_VERSION;
  bundleId: string;
  compiler: {
    version: string;
    configuration: JsonValue;
  };
  parsers: readonly NormalizedParserProfile[];
  model: {
    provider: string;
    model: string;
    configuration: JsonValue;
  };
  outputLanguage: string;
  okfVersion: typeof SUPPORTED_OKF_VERSION;
  citationContractVersion: typeof KNOWLEDGE_CITATION_CONTRACT_VERSION;
}

interface ParsedBundleWatchInput {
  bundle: KnowledgeBundleConfig;
  bundleConfigDigest: string;
  manifest: SourceManifest;
  schemaPathKey: string;
  schemaContentHash: string;
  pipeline: NormalizedPipelineProfile;
  pipelineProfileDigest: string;
}

interface GeneratedOutputCollisionProbe {
  readonly sourceIds: Set<string>;
  readonly path: string;
  readonly ownership: GeneratedPageOwnership;
  readonly contentHash?: string;
}

interface KnowledgeSourceWatchPlanState {
  sources: readonly ImmutableWatchedKnowledgeSource[];
  sourcesByPathKey: ReadonlyMap<string, readonly ImmutableWatchedKnowledgeSource[]>;
  sourcesByIdentity: ReadonlyMap<string, ImmutableWatchedKnowledgeSource>;
  generatedOutputs: readonly ImmutableWatchedKnowledgeGeneratedOutput[];
  generatedOutputsByPathKey: ReadonlyMap<string, ImmutableWatchedKnowledgeGeneratedOutput>;
  generatedOutputSourcesByPathKey: ReadonlyMap<string, readonly ImmutableWatchedKnowledgeSource[]>;
  parserAuthorities: readonly ImmutableSourceParserAuthority[];
  parserAuthoritiesBySource: ReadonlyMap<string, ImmutableSourceParserAuthority>;
  authorities: readonly ImmutableBundleWatchAuthority[];
  authoritiesByBundle: ReadonlyMap<string, ImmutableBundleWatchAuthority>;
  digest: string;
}

const PLAN_CONSTRUCTOR_TOKEN = Symbol("KnowledgeSourceWatchPlan.constructor");
const planStates = new WeakMap<object, KnowledgeSourceWatchPlanState>();
const EMPTY_SOURCES: readonly ImmutableWatchedKnowledgeSource[] = Object.freeze([]);

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  const actualKeys = Object.keys(value).sort(compareText);
  const expectedKeys = [...keys].sort(compareText);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function snapshotExactDataRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  if (!isExactRecord(value, keys)) {
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

function snapshotJsonValue(value: unknown, ancestors: Set<object> = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Expected a finite JSON number");
    }
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new TypeError("Expected an acyclic JSON value");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        lengthDescriptor.enumerable ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > 0xffffffff
      ) {
        throw new TypeError("Expected a strict JSON array length");
      }
      const length = lengthDescriptor.value as number;
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== length + 1 || ownKeys.some((key) => typeof key !== "string")) {
        throw new TypeError("Expected a strict JSON array");
      }
      const snapshot = new Array<JsonValue>(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError("Expected a dense data-property JSON array");
        }
        snapshot[index] = snapshotJsonValue(descriptor.value, ancestors);
      }
      Object.freeze(snapshot);
      return snapshot;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Expected a plain JSON object");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new TypeError("Expected string-only JSON object keys");
    }
    const snapshot: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of (ownKeys as string[]).sort(compareText)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Expected enumerable data-property JSON fields");
      }
      Object.defineProperty(snapshot, key, {
        value: snapshotJsonValue(descriptor.value, ancestors),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    Object.freeze(snapshot);
    return snapshot;
  } finally {
    ancestors.delete(value);
  }
}

function isCanonicalText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function pathsOverlap(left: string, right: string): boolean {
  return isPathWithinRoot(left, right) || isPathWithinRoot(right, left);
}

function createBundleSourceKey(bundleId: string, sourceId: string): string {
  return `${bundleId.length}:${bundleId}${sourceId.length}:${sourceId}`;
}

function readBundleIdForSorting(value: unknown): string {
  const input = snapshotExactDataRecord(value, ["bundle", "manifest", "schema", "pipeline"]);
  if (!input) return "";
  const bundle = snapshotExactDataRecord(input.bundle, [
    "version",
    "id",
    "sourceRoots",
    "wikiRoot",
    "schemaRef",
    "reviewMode",
  ]);
  return bundle && typeof bundle.id === "string" ? bundle.id : "";
}

function normalizePathSuffix(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.trim() !== value ||
    !value.startsWith(".") ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    return undefined;
  }
  return toWindowsPathKey(value);
}

function normalizeParserProfile(
  value: unknown,
  bundleIndex: number,
  parserIndex: number
): NormalizedParserProfile {
  if (
    !isExactRecord(value, ["id", "version", "pathSuffixes", "configuration"]) ||
    !isCanonicalText(value.id) ||
    !isCanonicalText(value.version) ||
    !Array.isArray(value.pathSuffixes) ||
    value.pathSuffixes.length === 0
  ) {
    throw new KnowledgeSourceWatchPlanBuildError("pipeline_profile_invalid", {
      bundleIndex,
      parserIndex,
    });
  }

  const suffixes = value.pathSuffixes.map(normalizePathSuffix);
  if (suffixes.some((suffix) => suffix === undefined)) {
    throw new KnowledgeSourceWatchPlanBuildError("parser_registry_invalid", {
      bundleIndex,
      parserIndex,
    });
  }
  const pathSuffixes = [...(suffixes as string[])].sort(compareText);
  if (new Set(pathSuffixes).size !== pathSuffixes.length) {
    throw new KnowledgeSourceWatchPlanBuildError("parser_registry_invalid", {
      bundleIndex,
      parserIndex,
    });
  }

  return {
    id: value.id,
    version: value.version,
    pathSuffixes: Object.freeze(pathSuffixes),
    configuration: value.configuration as JsonValue,
  };
}

function validateParserRegistry(
  parsers: readonly NormalizedParserProfile[],
  bundleIndex: number
): void {
  const parserIds = new Set<string>();
  for (let parserIndex = 0; parserIndex < parsers.length; parserIndex += 1) {
    const parser = parsers[parserIndex];
    if (parserIds.has(parser.id)) {
      throw new KnowledgeSourceWatchPlanBuildError("parser_registry_invalid", {
        bundleIndex,
        parserIndex,
      });
    }
    parserIds.add(parser.id);

    for (let otherIndex = 0; otherIndex < parserIndex; otherIndex += 1) {
      const other = parsers[otherIndex];
      const overlaps = parser.pathSuffixes.some((suffix) =>
        other.pathSuffixes.some(
          (otherSuffix) => suffix.endsWith(otherSuffix) || otherSuffix.endsWith(suffix)
        )
      );
      if (overlaps) {
        throw new KnowledgeSourceWatchPlanBuildError("parser_registry_invalid", {
          bundleIndex,
          parserIndex,
        });
      }
    }
  }
}

function normalizePipelineProfile(
  value: unknown,
  bundle: KnowledgeBundleConfig,
  bundleConfigDigest: string,
  schemaContentHash: string,
  bundleIndex: number
): { profile: NormalizedPipelineProfile; digest: string } {
  let snapshot: JsonValue;
  try {
    snapshot = snapshotJsonValue(value);
  } catch {
    throw new KnowledgeSourceWatchPlanBuildError("pipeline_profile_invalid", { bundleIndex });
  }
  if (
    !isExactRecord(snapshot, [
      "version",
      "bundleId",
      "compiler",
      "parsers",
      "model",
      "outputLanguage",
      "okfVersion",
      "citationContractVersion",
    ]) ||
    snapshot.version !== KNOWLEDGE_PIPELINE_PROFILE_VERSION ||
    snapshot.bundleId !== bundle.id ||
    !isExactRecord(snapshot.compiler, ["version", "configuration"]) ||
    !isCanonicalText(snapshot.compiler.version) ||
    !Array.isArray(snapshot.parsers) ||
    snapshot.parsers.length === 0 ||
    !isExactRecord(snapshot.model, ["provider", "model", "configuration"]) ||
    !isCanonicalText(snapshot.model.provider) ||
    !isCanonicalText(snapshot.model.model) ||
    !isCanonicalText(snapshot.outputLanguage) ||
    snapshot.okfVersion !== SUPPORTED_OKF_VERSION ||
    snapshot.citationContractVersion !== KNOWLEDGE_CITATION_CONTRACT_VERSION
  ) {
    throw new KnowledgeSourceWatchPlanBuildError("pipeline_profile_invalid", { bundleIndex });
  }

  const parsers = snapshot.parsers
    .map((parser, parserIndex) => normalizeParserProfile(parser, bundleIndex, parserIndex))
    .sort(
      (left, right) => compareText(left.id, right.id) || compareText(left.version, right.version)
    );
  validateParserRegistry(parsers, bundleIndex);

  const profile: NormalizedPipelineProfile = {
    version: KNOWLEDGE_PIPELINE_PROFILE_VERSION,
    bundleId: bundle.id,
    compiler: {
      version: snapshot.compiler.version,
      configuration: snapshot.compiler.configuration,
    },
    parsers: Object.freeze(parsers),
    model: {
      provider: snapshot.model.provider,
      model: snapshot.model.model,
      configuration: snapshot.model.configuration,
    },
    outputLanguage: snapshot.outputLanguage,
    okfVersion: SUPPORTED_OKF_VERSION,
    citationContractVersion: KNOWLEDGE_CITATION_CONTRACT_VERSION,
  };

  try {
    for (const parser of profile.parsers) {
      createPipelineFingerprint(
        createFingerprintInput(profile, parser, bundleConfigDigest, schemaContentHash)
      );
    }
    const digestValue: JsonValue = {
      version: profile.version,
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      bundleId: profile.bundleId,
      compiler: profile.compiler,
      parsers: profile.parsers.map((parser) => ({
        id: parser.id,
        version: parser.version,
        pathSuffixes: [...parser.pathSuffixes],
        configuration: parser.configuration,
      })),
      model: profile.model,
      outputLanguage: profile.outputLanguage,
      okfVersion: profile.okfVersion,
      citationContractVersion: profile.citationContractVersion,
    };
    return {
      profile,
      digest: sha256(`knowledge-pipeline-profile-v1\n${canonicalizeJson(digestValue)}`),
    };
  } catch {
    throw new KnowledgeSourceWatchPlanBuildError("pipeline_profile_invalid", { bundleIndex });
  }
}

function createFingerprintInput(
  profile: NormalizedPipelineProfile,
  parser: NormalizedParserProfile,
  bundleConfigDigest: string,
  schemaContentHash: string
): PipelineFingerprintInput {
  return {
    version: KNOWLEDGE_CONTRACT_VERSION,
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    compilerVersion: profile.compiler.version,
    compilerConfiguration: profile.compiler.configuration,
    bundleConfigDigest,
    parser: {
      id: parser.id,
      version: parser.version,
      configuration: parser.configuration,
    },
    schemaHash: schemaContentHash,
    model: profile.model,
    outputLanguage: profile.outputLanguage,
    okfVersion: profile.okfVersion,
    citationContractVersion: profile.citationContractVersion,
  };
}

function createSourcePipelineFingerprint(
  basePipelineFingerprint: string,
  operation: KnowledgeSourceCompileOperation,
  sourceOriginDigest?: string
): string {
  if (operation === "ingest") return basePipelineFingerprint;
  if (!sourceOriginDigest) {
    throw new KnowledgeSourceWatchPlanBuildError("source_origin_invalid");
  }
  return sha256(
    `knowledge-query-writeback-pipeline-v1\n${canonicalizeJson({
      basePipelineFingerprint,
      operation,
      sourceOriginDigest,
    })}`
  );
}

function parseBundleWatchInput(value: unknown, bundleIndex: number): ParsedBundleWatchInput {
  const input = snapshotExactDataRecord(value, ["bundle", "manifest", "schema", "pipeline"]);
  if (!input) {
    throw new KnowledgeSourceWatchPlanBuildError("input_invalid", { bundleIndex });
  }

  let bundleSnapshot: JsonValue;
  try {
    bundleSnapshot = snapshotJsonValue(input.bundle);
  } catch {
    throw new KnowledgeSourceWatchPlanBuildError("bundle_invalid", { bundleIndex });
  }
  const parsedBundle = parseKnowledgeBundleConfig(bundleSnapshot);
  if (!parsedBundle.ok) {
    throw new KnowledgeSourceWatchPlanBuildError("bundle_invalid", { bundleIndex });
  }

  let manifestSnapshot: JsonValue;
  try {
    manifestSnapshot = snapshotJsonValue(input.manifest);
  } catch {
    throw new KnowledgeSourceWatchPlanBuildError("manifest_invalid", { bundleIndex });
  }
  const parsedManifest = parseSourceManifest(manifestSnapshot);
  if (!parsedManifest.ok) {
    throw new KnowledgeSourceWatchPlanBuildError("manifest_invalid", { bundleIndex });
  }
  if (!validateSourceManifestForBundle(parsedManifest.value, parsedBundle.value).valid) {
    throw new KnowledgeSourceWatchPlanBuildError("manifest_bundle_invalid", { bundleIndex });
  }

  const schema = snapshotExactDataRecord(input.schema, ["path", "bytes"]);
  if (!schema) {
    throw new KnowledgeSourceWatchPlanBuildError("schema_snapshot_invalid", { bundleIndex });
  }
  const parsedSchemaPath = parseVaultPath(schema.path);
  if (
    !parsedSchemaPath.ok ||
    parsedSchemaPath.path !== parsedBundle.value.schemaRef ||
    !isExactUint8Array(schema.bytes)
  ) {
    throw new KnowledgeSourceWatchPlanBuildError("schema_snapshot_invalid", { bundleIndex });
  }
  const schemaContentHash = createSourceContentHash(new Uint8Array(schema.bytes));
  const bundleConfigDigest = createKnowledgeBundleConfigDigest(parsedBundle.value);
  const normalizedPipeline = normalizePipelineProfile(
    input.pipeline,
    parsedBundle.value,
    bundleConfigDigest,
    schemaContentHash,
    bundleIndex
  );

  return {
    bundle: parsedBundle.value,
    bundleConfigDigest,
    manifest: parsedManifest.value,
    schemaPathKey: toWindowsPathKey(parsedSchemaPath.path),
    schemaContentHash,
    pipeline: normalizedPipeline.profile,
    pipelineProfileDigest: normalizedPipeline.digest,
  };
}

function validateCrossBundleBoundaries(inputs: readonly ParsedBundleWatchInput[]): void {
  for (let bundleIndex = 0; bundleIndex < inputs.length; bundleIndex += 1) {
    const current = inputs[bundleIndex].bundle;
    if (bundleIndex > 0 && inputs[bundleIndex - 1].bundle.id === current.id) {
      throw new KnowledgeSourceWatchPlanBuildError("bundle_id_duplicate", { bundleIndex });
    }

    for (let otherIndex = 0; otherIndex < bundleIndex; otherIndex += 1) {
      const otherInput = inputs[otherIndex];
      const other = otherInput.bundle;
      if (
        inputs[bundleIndex].schemaPathKey === otherInput.schemaPathKey &&
        inputs[bundleIndex].schemaContentHash !== otherInput.schemaContentHash
      ) {
        throw new KnowledgeSourceWatchPlanBuildError("schema_snapshot_conflict", { bundleIndex });
      }
      const wikiConflict =
        pathsOverlap(current.wikiRoot, other.wikiRoot) ||
        current.sourceRoots.some((root) => pathsOverlap(root, other.wikiRoot)) ||
        other.sourceRoots.some((root) => pathsOverlap(root, current.wikiRoot)) ||
        isPathWithinRoot(current.schemaRef, other.wikiRoot) ||
        isPathWithinRoot(other.schemaRef, current.wikiRoot);
      if (wikiConflict) {
        throw new KnowledgeSourceWatchPlanBuildError("bundle_boundary_conflict", { bundleIndex });
      }
    }
  }
}

function selectSourceParser(
  profile: NormalizedPipelineProfile,
  sourcePathKey: string,
  bundleIndex: number,
  sourceIndex: number
): NormalizedParserProfile {
  const matches = profile.parsers.filter((parser) =>
    parser.pathSuffixes.some((suffix) => sourcePathKey.endsWith(suffix))
  );
  if (matches.length === 0) {
    throw new KnowledgeSourceWatchPlanBuildError("source_parser_missing", {
      bundleIndex,
      sourceIndex,
    });
  }
  if (matches.length !== 1) {
    throw new KnowledgeSourceWatchPlanBuildError("source_parser_ambiguous", {
      bundleIndex,
      sourceIndex,
    });
  }
  return matches[0];
}

function hasGeneratedOutputCollision(manifest: SourceManifest): boolean {
  const seen = new Map<string, GeneratedOutputCollisionProbe>();
  for (const entry of manifest.entries) {
    for (const page of entry.lastSuccessful?.generatedPages ?? []) {
      const key = toWindowsPathKey(page.path);
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, {
          sourceIds: new Set([entry.sourceId]),
          path: page.path,
          ownership: page.ownership,
          contentHash: page.contentHash,
        });
        continue;
      }
      if (
        existing.sourceIds.has(entry.sourceId) ||
        existing.path !== page.path ||
        existing.ownership !== page.ownership ||
        existing.contentHash !== page.contentHash
      ) {
        return true;
      }
      existing.sourceIds.add(entry.sourceId);
    }
  }
  return false;
}

function projectGeneratedOutputs(
  input: ParsedBundleWatchInput,
  bundleIndex: number
): readonly ImmutableWatchedKnowledgeGeneratedOutput[] {
  try {
    return Object.freeze(
      projectKnowledgeEffectiveManifestPages(input.manifest).map((page) =>
        Object.freeze({
          bundleId: page.bundleId,
          outputPath: page.path,
          outputKey: page.windowsPathKey,
          ownership: page.ownership,
          sourceAppliedContentHash: page.sourceAppliedContentHash,
          effectiveContentHash: page.effectiveContentHash,
          contentHash: page.effectiveContentHash,
          origin: page.origin,
          sourceIds: page.sourceIds,
        })
      )
    );
  } catch {
    throw new KnowledgeSourceWatchPlanBuildError(
      hasGeneratedOutputCollision(input.manifest)
        ? "generated_output_collision"
        : "generated_output_invalid",
      { bundleIndex }
    );
  }
}

function projectBundleWatchInput(
  input: ParsedBundleWatchInput,
  bundleIndex: number
): {
  sources: readonly ImmutableWatchedKnowledgeSource[];
  generatedOutputs: readonly ImmutableWatchedKnowledgeGeneratedOutput[];
  parserAuthorities: readonly ImmutableSourceParserAuthority[];
  authority: ImmutableBundleWatchAuthority;
} {
  const entries = [...input.manifest.entries].sort(
    (left, right) =>
      compareText(left.sourceKey, right.sourceKey) || compareText(left.sourceId, right.sourceId)
  );
  const parserAuthorities: ImmutableSourceParserAuthority[] = [];
  const sources = entries.map((entry, sourceIndex) => {
    const parser = selectSourceParser(input.pipeline, entry.sourceKey, bundleIndex, sourceIndex);
    let sourceAuthority: ReturnType<typeof deriveKnowledgeSourceCompileAuthority>;
    try {
      sourceAuthority = deriveKnowledgeSourceCompileAuthority(entry);
    } catch {
      throw new KnowledgeSourceWatchPlanBuildError("source_origin_invalid", {
        bundleIndex,
        sourceIndex,
      });
    }
    parserAuthorities.push(
      Object.freeze({
        bundleId: input.bundle.id,
        sourceId: entry.sourceId,
        parserId: parser.id,
        parserVersion: parser.version,
        parserProfileDigest: createKnowledgeSourceParserProfileDigest(parser),
      })
    );
    const basePipelineFingerprint = createPipelineFingerprint(
      createFingerprintInput(
        input.pipeline,
        parser,
        input.bundleConfigDigest,
        input.schemaContentHash
      )
    );
    const common = {
      bundleId: input.bundle.id,
      sourceId: entry.sourceId,
      sourcePath: entry.sourcePath,
      sourceKey: entry.sourceKey,
      pipelineFingerprint: createSourcePipelineFingerprint(
        basePipelineFingerprint,
        sourceAuthority.operation,
        sourceAuthority.operation === "query_writeback"
          ? sourceAuthority.sourceOriginDigest
          : undefined
      ),
    };
    return sourceAuthority.operation === "query_writeback"
      ? Object.freeze({
          ...common,
          operation: sourceAuthority.operation,
          sourceOriginDigest: sourceAuthority.sourceOriginDigest,
          expectedSourceContentHash: sourceAuthority.expectedSourceContentHash,
        })
      : Object.freeze(common);
  });
  const authority = Object.freeze({
    bundleId: input.bundle.id,
    bundleConfigDigest: input.bundleConfigDigest,
    manifestRevision: input.manifest.revision,
    manifestDigest: createSourceManifestDigest(input.manifest),
    schemaContentHash: input.schemaContentHash,
    pipelineProfileDigest: input.pipelineProfileDigest,
    sourceCount: sources.length,
  });
  return {
    sources: Object.freeze(sources),
    generatedOutputs: projectGeneratedOutputs(input, bundleIndex),
    parserAuthorities: Object.freeze(parserAuthorities),
    authority,
  };
}

export function createKnowledgeSourceParserProfileDigest(
  parser: KnowledgeSourceParserProfile
): string {
  let snapshot: JsonValue;
  try {
    snapshot = snapshotJsonValue(parser);
  } catch {
    throw new KnowledgeSourceWatchPlanBuildError("parser_registry_invalid");
  }
  if (
    !isExactRecord(snapshot, ["id", "version", "pathSuffixes", "configuration"]) ||
    !isCanonicalText(snapshot.id) ||
    !isCanonicalText(snapshot.version) ||
    !Array.isArray(snapshot.pathSuffixes) ||
    snapshot.pathSuffixes.length === 0
  ) {
    throw new KnowledgeSourceWatchPlanBuildError("parser_registry_invalid");
  }
  const normalizedSuffixes = snapshot.pathSuffixes.map(normalizePathSuffix);
  if (normalizedSuffixes.some((suffix) => suffix === undefined)) {
    throw new KnowledgeSourceWatchPlanBuildError("parser_registry_invalid");
  }
  const pathSuffixes = [...(normalizedSuffixes as string[])].sort(compareText);
  if (new Set(pathSuffixes).size !== pathSuffixes.length) {
    throw new KnowledgeSourceWatchPlanBuildError("parser_registry_invalid");
  }
  try {
    assertKnowledgeConfigurationContainsNoSecrets(snapshot.configuration);
  } catch {
    throw new KnowledgeSourceWatchPlanBuildError("parser_registry_invalid");
  }
  return sha256(
    `knowledge-source-parser-profile-v1\n${canonicalizeJson({
      id: snapshot.id,
      version: snapshot.version,
      pathSuffixes,
      configuration: snapshot.configuration,
    })}`
  );
}

function createGeneratedOutputOriginDigestValue(
  origin: Readonly<KnowledgeEffectivePageOrigin>
): JsonValue {
  if (origin.kind === "source_apply") return { kind: origin.kind };
  return { kind: origin.kind, overlay: { ...origin.overlay } };
}

function createWatchPlanDigest(
  sources: readonly ImmutableWatchedKnowledgeSource[],
  generatedOutputs: readonly ImmutableWatchedKnowledgeGeneratedOutput[],
  parserAuthorities: readonly ImmutableSourceParserAuthority[],
  authorities: readonly ImmutableBundleWatchAuthority[]
): string {
  const value: JsonValue = {
    version: KNOWLEDGE_PIPELINE_PROFILE_VERSION,
    authorities: authorities.map((authority) => ({ ...authority })),
    sources: sources.map((source) => ({ ...source })),
    generatedOutputs: generatedOutputs.map((output) => ({
      ...output,
      origin: createGeneratedOutputOriginDigestValue(output.origin),
      sourceIds: [...output.sourceIds],
    })),
    parserAuthorities: parserAuthorities.map((authority) => ({ ...authority })),
  };
  return sha256(`knowledge-source-watch-plan-v1\n${canonicalizeJson(value)}`);
}

function requirePlanState(value: unknown): KnowledgeSourceWatchPlanState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeSourceWatchPlanBuildError("plan_not_authoritative");
  }
  const state = planStates.get(value);
  if (!state) {
    throw new KnowledgeSourceWatchPlanBuildError("plan_not_authoritative");
  }
  return state;
}

export class KnowledgeSourceWatchPlan {
  private constructor(
    token: symbol,
    sources: readonly ImmutableWatchedKnowledgeSource[],
    generatedOutputs: readonly ImmutableWatchedKnowledgeGeneratedOutput[],
    parserAuthorities: readonly ImmutableSourceParserAuthority[],
    authorities: readonly ImmutableBundleWatchAuthority[]
  ) {
    if (token !== PLAN_CONSTRUCTOR_TOKEN) {
      throw new KnowledgeSourceWatchPlanBuildError("plan_not_authoritative");
    }
    const sourcesByPathKey = new Map<string, ImmutableWatchedKnowledgeSource[]>();
    const sourcesByIdentity = new Map<string, ImmutableWatchedKnowledgeSource>();
    for (const source of sources) {
      const matching = sourcesByPathKey.get(source.sourceKey);
      if (matching) {
        matching.push(source);
      } else {
        sourcesByPathKey.set(source.sourceKey, [source]);
      }
      sourcesByIdentity.set(createBundleSourceKey(source.bundleId, source.sourceId), source);
    }
    for (const matching of sourcesByPathKey.values()) {
      Object.freeze(matching);
    }
    const generatedOutputsByPathKey = new Map<string, ImmutableWatchedKnowledgeGeneratedOutput>();
    const generatedOutputSourcesByPathKey = new Map<
      string,
      readonly ImmutableWatchedKnowledgeSource[]
    >();
    for (const output of generatedOutputs) {
      if (generatedOutputsByPathKey.has(output.outputKey)) {
        throw new KnowledgeSourceWatchPlanBuildError("generated_output_collision");
      }
      const owners = output.sourceIds.map((sourceId) => {
        const source = sourcesByIdentity.get(createBundleSourceKey(output.bundleId, sourceId));
        if (!source) {
          throw new KnowledgeSourceWatchPlanBuildError("generated_output_invalid");
        }
        return source;
      });
      generatedOutputsByPathKey.set(output.outputKey, output);
      generatedOutputSourcesByPathKey.set(output.outputKey, Object.freeze(owners));
    }
    const state: KnowledgeSourceWatchPlanState = Object.freeze({
      sources,
      sourcesByPathKey,
      sourcesByIdentity,
      generatedOutputs,
      generatedOutputsByPathKey,
      generatedOutputSourcesByPathKey,
      parserAuthorities,
      parserAuthoritiesBySource: new Map(
        parserAuthorities.map((authority) => [
          createBundleSourceKey(authority.bundleId, authority.sourceId),
          authority,
        ])
      ),
      authorities,
      authoritiesByBundle: new Map(authorities.map((authority) => [authority.bundleId, authority])),
      digest: createWatchPlanDigest(sources, generatedOutputs, parserAuthorities, authorities),
    });
    planStates.set(this, state);
    Object.freeze(this);
  }

  static build(values: readonly KnowledgeBundleWatchPlanInput[]): KnowledgeSourceWatchPlan {
    try {
      if (!Array.isArray(values)) {
        throw new KnowledgeSourceWatchPlanBuildError("input_invalid");
      }
      const typedValues: readonly KnowledgeBundleWatchPlanInput[] = values;
      const sortableValues = typedValues.map((value, inputIndex) => {
        const bundleId = readBundleIdForSorting(value);
        return { value, inputIndex, bundleId };
      });
      sortableValues.sort(
        (left, right) =>
          compareText(left.bundleId, right.bundleId) || left.inputIndex - right.inputIndex
      );

      const inputs = sortableValues.map(({ value }, bundleIndex) =>
        parseBundleWatchInput(value, bundleIndex)
      );
      inputs.sort((left, right) => compareText(left.bundle.id, right.bundle.id));
      validateCrossBundleBoundaries(inputs);

      const sources: ImmutableWatchedKnowledgeSource[] = [];
      const generatedOutputs: ImmutableWatchedKnowledgeGeneratedOutput[] = [];
      const parserAuthorities: ImmutableSourceParserAuthority[] = [];
      const authorities: ImmutableBundleWatchAuthority[] = [];
      inputs.forEach((input, bundleIndex) => {
        const projection = projectBundleWatchInput(input, bundleIndex);
        sources.push(...projection.sources);
        generatedOutputs.push(...projection.generatedOutputs);
        parserAuthorities.push(...projection.parserAuthorities);
        authorities.push(projection.authority);
      });
      sources.sort(
        (left, right) =>
          compareText(left.sourceKey, right.sourceKey) ||
          compareText(left.bundleId, right.bundleId) ||
          compareText(left.sourceId, right.sourceId)
      );

      parserAuthorities.sort(
        (left, right) =>
          compareText(left.bundleId, right.bundleId) || compareText(left.sourceId, right.sourceId)
      );

      generatedOutputs.sort(
        (left, right) =>
          compareText(left.outputKey, right.outputKey) || compareText(left.bundleId, right.bundleId)
      );

      return new KnowledgeSourceWatchPlan(
        PLAN_CONSTRUCTOR_TOKEN,
        Object.freeze(sources),
        Object.freeze(generatedOutputs),
        Object.freeze(parserAuthorities),
        Object.freeze(authorities)
      );
    } catch (error) {
      if (error instanceof KnowledgeSourceWatchPlanBuildError) {
        throw error;
      }
      throw new KnowledgeSourceWatchPlanBuildError("input_invalid");
    }
  }

  static assert(value: unknown): asserts value is KnowledgeSourceWatchPlan {
    requirePlanState(value);
  }

  getSources(): readonly ImmutableWatchedKnowledgeSource[] {
    return requirePlanState(this).sources;
  }

  getSourcesForPathKey(pathKey: string): readonly ImmutableWatchedKnowledgeSource[] {
    return requirePlanState(this).sourcesByPathKey.get(pathKey) ?? EMPTY_SOURCES;
  }

  getSource(bundleId: string, sourceId: string): ImmutableWatchedKnowledgeSource | undefined {
    return requirePlanState(this).sourcesByIdentity.get(createBundleSourceKey(bundleId, sourceId));
  }

  getGeneratedOutputs(): readonly ImmutableWatchedKnowledgeGeneratedOutput[] {
    return requirePlanState(this).generatedOutputs;
  }

  getGeneratedOutputForPathKey(
    pathKey: string
  ): ImmutableWatchedKnowledgeGeneratedOutput | undefined {
    return requirePlanState(this).generatedOutputsByPathKey.get(pathKey);
  }

  getSourcesForGeneratedOutputPathKey(pathKey: string): readonly ImmutableWatchedKnowledgeSource[] {
    return requirePlanState(this).generatedOutputSourcesByPathKey.get(pathKey) ?? EMPTY_SOURCES;
  }

  getSourceParserAuthority(
    bundleId: string,
    sourceId: string
  ): ImmutableSourceParserAuthority | undefined {
    return requirePlanState(this).parserAuthoritiesBySource.get(
      createBundleSourceKey(bundleId, sourceId)
    );
  }

  getBundleAuthorities(): readonly ImmutableBundleWatchAuthority[] {
    return requirePlanState(this).authorities;
  }

  getBundleAuthority(bundleId: string): ImmutableBundleWatchAuthority | undefined {
    return requirePlanState(this).authoritiesByBundle.get(bundleId);
  }

  getDigest(): string {
    return requirePlanState(this).digest;
  }
}

Object.freeze(KnowledgeSourceWatchPlan.prototype);
Object.freeze(KnowledgeSourceWatchPlan);

export function buildKnowledgeSourceWatchPlan(
  inputs: readonly KnowledgeBundleWatchPlanInput[]
): KnowledgeSourceWatchPlan {
  return KnowledgeSourceWatchPlan.build(inputs);
}
