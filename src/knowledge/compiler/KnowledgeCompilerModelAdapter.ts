import {
  KNOWLEDGE_COMPILER_PROTOCOL_VERSION,
  type CompilerAnalysis,
  type CompilerAnalysisRequest,
  type CompilerBoundTarget,
  type CompilerGenerationRequest,
  type CompilerModelPort,
  type KnowledgeCompilerInfrastructureFailureCode,
} from "@/knowledge/compiler/CompilerModelPort";
import { parseCompilerAnalysisModelOutput } from "@/knowledge/compiler/analysisSchema";
import { parseCompilerGenerationModelOutput } from "@/knowledge/compiler/generationSchema";
import {
  KnowledgeCompilerModelCallAuthorization,
  KnowledgeCompilerModelSession,
} from "@/knowledge/compiler/KnowledgeCompiler";
import {
  KnowledgeAuthorizedSourcePreparation as AuthorizedSourcePreparation,
  type KnowledgeAuthorizedSourcePreparation,
} from "@/knowledge/ingest/KnowledgeAuthorizedSourcePreparation";
import type { KnowledgeBundlePipelineProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import {
  assertKnowledgeConfigurationContainsNoSecrets,
  canonicalizeJson,
} from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";
import { sha256 } from "@/utils/hash";

/** Current private model-route contract accepted by this isolated adapter. */
const SUPPORTED_PRIVATE_MODEL_ROUTE_CONTRACT_VERSION = 1 as const;

/** Provider-neutral decoded-object contract returned to the compiler core. */
export const KNOWLEDGE_DECODED_MODEL_OUTPUT_CONTRACT = "decoded-object-core-schema-v1" as const;

const MODEL_ADAPTER_POLICY = "knowledge-projection-only-v1";
const PRIVATE_ROUTING_POLICY = "private-bound-capability-v1";
const SUPPORTED_MODEL_BEHAVIOR_CONTRACT_VERSION = 1 as const;
const ROUTE_TOKEN = Symbol("KnowledgePrivateModelRoute.constructor");
const ADAPTER_TOKEN = Symbol("KnowledgeCompilerModelAdapter.constructor");
const ADAPTER_ERROR_TOKEN = Symbol("KnowledgeCompilerModelAdapterError.constructor");
const REFLECT_APPLY = Reflect.apply;
const MAX_PRIVATE_MODEL_WIRE_CHARACTERS = 16_000_000;
const MAX_PRIVATE_MODEL_WIRE_BYTES = 32_000_000;

/** Immutable secret-free declaration paired with one private route closure. */
export interface KnowledgePrivateModelRouteDescriptor {
  provider: string;
  model: string;
  configuration: JsonValue;
}

/** Model work stages exposed to a private provider route. */
export type KnowledgePrivateModelStage = "analysis" | "generation";

/** Private transport closure retained only in module-owned route state. */
export type KnowledgePrivateModelInvoke = (
  stage: KnowledgePrivateModelStage,
  request: Readonly<CompilerAnalysisRequest | CompilerGenerationRequest>,
  signal: AbortSignal
) => Promise<string>;

/** Sanitized concrete-provider categories retained across the private route boundary. */
export type KnowledgePrivateModelProviderFailureCode =
  | "request_rejected"
  | "unauthorized"
  | "insufficient_balance"
  | "rate_limited"
  | "provider_unavailable"
  | "network_failed"
  | "http_failed"
  | "request_too_large"
  | "response_too_large"
  | "response_invalid";

/** Route-owned classifier that translates only its concrete sanitized failures. */
export type KnowledgePrivateModelFailureClassifier = (
  error: unknown
) => KnowledgePrivateModelProviderFailureCode | undefined;

/** Queue-owned monotonic stage reporter captured by one job-bound adapter. */
export type KnowledgeModelStageReporter = (stage: "analyzing" | "generating") => Promise<void>;

/** Independent decoded-object resource limits applied after provider decoding. */
interface KnowledgeDecodedModelOutputLimits {
  maxDepth: number;
  maxNodes: number;
  maxArrayLength: number;
  maxObjectProperties: number;
  maxTotalCharacters: number;
}

/** Safe defaults below the compiler's independent semantic collection limits. */
const FIXED_KNOWLEDGE_DECODED_MODEL_OUTPUT_LIMITS: Readonly<KnowledgeDecodedModelOutputLimits> =
  Object.freeze({
    maxDepth: 64,
    maxNodes: 100_000,
    maxArrayLength: 10_000,
    maxObjectProperties: 10_000,
    maxTotalCharacters: 8_000_000,
  });

/** Stable failure categories that never include provider or credential material. */
export type KnowledgeCompilerModelAdapterErrorCode =
  | "dependency_invalid"
  | "preparation_invalid"
  | "preparation_reused"
  | "route_invalid"
  | "profile_mismatch"
  | "request_invalid"
  | "request_not_authorized"
  | "generation_not_authorized"
  | "signal_mismatch"
  | "stage_invalid"
  | "authority_stale"
  | "route_failed"
  | "output_invalid"
  | "output_too_large"
  | "adapter_invalid";

interface KnowledgeCompilerModelAdapterErrorState {
  code: KnowledgeCompilerModelAdapterErrorCode;
  providerFailure?: KnowledgePrivateModelProviderFailureCode;
}

const adapterErrorStates = new WeakMap<object, Readonly<KnowledgeCompilerModelAdapterErrorState>>();
const ADAPTER_ERROR_CODES = new Set<KnowledgeCompilerModelAdapterErrorCode>([
  "dependency_invalid",
  "preparation_invalid",
  "preparation_reused",
  "route_invalid",
  "profile_mismatch",
  "request_invalid",
  "request_not_authorized",
  "generation_not_authorized",
  "signal_mismatch",
  "stage_invalid",
  "authority_stale",
  "route_failed",
  "output_invalid",
  "output_too_large",
  "adapter_invalid",
]);
const PROVIDER_FAILURE_CODES = new Set<KnowledgePrivateModelProviderFailureCode>([
  "request_rejected",
  "unauthorized",
  "insufficient_balance",
  "rate_limited",
  "provider_unavailable",
  "network_failed",
  "http_failed",
  "request_too_large",
  "response_too_large",
  "response_invalid",
]);

/** Returns hidden adapter-error state only for a module-minted instance. */
function requireKnowledgeCompilerModelAdapterErrorState(
  value: unknown
): Readonly<KnowledgeCompilerModelAdapterErrorState> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("The knowledge compiler model adapter error is invalid");
  }
  const state = adapterErrorStates.get(value);
  if (!state) {
    throw new TypeError("The knowledge compiler model adapter error is invalid");
  }
  return state;
}

/** Creates one authentic sanitized adapter error with optional provider identity. */
function createKnowledgeCompilerModelAdapterError(
  code: KnowledgeCompilerModelAdapterErrorCode,
  providerFailure?: KnowledgePrivateModelProviderFailureCode
): KnowledgeCompilerModelAdapterError {
  return new KnowledgeCompilerModelAdapterError(ADAPTER_ERROR_TOKEN, code, providerFailure);
}

/** Sanitized model-boundary error retaining no lower-level cause or response value. */
export class KnowledgeCompilerModelAdapterError extends Error {
  /** Creates one error only when called by this module's private helper. */
  constructor(
    token: symbol,
    code: KnowledgeCompilerModelAdapterErrorCode,
    providerFailure?: KnowledgePrivateModelProviderFailureCode
  ) {
    super("The private knowledge compiler model operation failed");
    if (
      token !== ADAPTER_ERROR_TOKEN ||
      !ADAPTER_ERROR_CODES.has(code) ||
      (providerFailure !== undefined && !PROVIDER_FAILURE_CODES.has(providerFailure))
    ) {
      throw new TypeError("The knowledge compiler model adapter error is invalid");
    }
    this.name = "KnowledgeCompilerModelAdapterError";
    adapterErrorStates.set(
      this,
      Object.freeze({
        code,
        ...(providerFailure === undefined ? {} : { providerFailure }),
      })
    );
    Object.freeze(this);
  }

  /** Reads one authentic adapter error without accepting prototype forgery. */
  static inspect(value: unknown): Readonly<KnowledgeCompilerModelAdapterErrorState> | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    return adapterErrorStates.get(value);
  }

  /** Returns the stable adapter code retained in hidden state. */
  get code(): KnowledgeCompilerModelAdapterErrorCode {
    return requireKnowledgeCompilerModelAdapterErrorState(this).code;
  }
}

Object.freeze(KnowledgeCompilerModelAdapterError.prototype);
Object.freeze(KnowledgeCompilerModelAdapterError);

interface CapturedRouteConfiguration {
  behaviorContractVersion: typeof SUPPORTED_MODEL_BEHAVIOR_CONTRACT_VERSION;
  routeContractVersion: typeof SUPPORTED_PRIVATE_MODEL_ROUTE_CONTRACT_VERSION;
  adapterPolicy: typeof MODEL_ADAPTER_POLICY;
  routingPolicy: typeof PRIVATE_ROUTING_POLICY;
  structuredOutput: typeof KNOWLEDGE_DECODED_MODEL_OUTPUT_CONTRACT;
  streaming: false;
  modelFallback: false;
  endpointIdentity?: string;
  routingIdentity?: string;
  configuration: JsonValue;
  configurationDigest: string;
}

interface KnowledgePrivateModelRouteState {
  descriptor: Readonly<KnowledgePrivateModelRouteDescriptor>;
  captured: CapturedRouteConfiguration;
  invoke: KnowledgePrivateModelInvoke;
  classifyFailure?: KnowledgePrivateModelFailureClassifier;
  profileDigest?: string;
}

interface AuthorizedPreparationSnapshot {
  operation: JsonValue;
  bundle: JsonValue;
  source: JsonValue;
  schema: JsonValue;
}

type AnalysisInvocationState =
  | "unavailable"
  | "available"
  | "validating"
  | "running"
  | "completed"
  | "failed";

type GenerationInvocationState =
  | "unavailable"
  | "validating"
  | "available"
  | "running"
  | "completed"
  | "failed";

interface AuthorizedAnalysisModelCall {
  requestIdentity: object;
  request: CompilerAnalysisRequest;
  requestDigest: string;
}

interface AuthorizedGenerationModelCall {
  requestIdentity: object;
  request: CompilerGenerationRequest;
  requestDigest: string;
  analysisDigest: string;
  targetSetDigest: string;
}

interface KnowledgeCompilerModelAdapterState {
  preparation: KnowledgeAuthorizedSourcePreparation;
  signal: AbortSignal;
  profile: KnowledgeBundlePipelineProfile;
  profileDigest: string;
  foundation: AuthorizedPreparationSnapshot;
  route: KnowledgePrivateModelRouteState;
  reportStage: KnowledgeModelStageReporter;
  analysisState: AnalysisInvocationState;
  generationState: GenerationInvocationState;
  modelSession?: KnowledgeCompilerModelSession;
  analysisAuthorization?: AuthorizedAnalysisModelCall;
  generationAuthorization?: AuthorizedGenerationModelCall;
  analysisOutput?: JsonValue;
  analysisOutputDigest?: string;
}

interface SnapshotBudget {
  nodes: number;
  characters: number;
}

interface JsonSnapshotLimits {
  maxDepth: number;
  maxNodes: number;
  maxArrayLength: number;
  maxObjectProperties: number;
  maxTotalCharacters: number;
}

const routeStates = new WeakMap<object, KnowledgePrivateModelRouteState>();
const adapterStates = new WeakMap<object, KnowledgeCompilerModelAdapterState>();
const reservedAdapterPreparations = new WeakSet<object>();

/** Compares strings by code unit without locale-dependent behavior. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Creates a sanitized cancellation without retaining an arbitrary abort reason. */
function createAbortError(): Error {
  const error = new Error("The private knowledge compiler model operation was aborted");
  error.name = "AbortError";
  return error;
}

/** Requires one non-empty canonical identity string. */
function requireCanonicalText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw createKnowledgeCompilerModelAdapterError("route_invalid");
  }
  return value;
}

/** Requires one plaintext-free SHA-256 route identity. */
function requireRouteIdentity(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw createKnowledgeCompilerModelAdapterError("route_invalid");
  }
  return value;
}

/** Reads one own enumerable data property without invoking an accessor. */
function readOwnDataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    throw new TypeError("Expected an object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("Expected an own data property");
  }
  return descriptor.value;
}

/** Reads one optional own enumerable data property without invoking an accessor. */
function readOptionalOwnDataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    throw new TypeError("Expected an object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("Expected an own data property");
  }
  return descriptor.value;
}

/** Checks whether the exact own string keys equal an expected set. */
function hasExactKeys(value: unknown, expectedKeys: readonly string[]): boolean {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const actual = Reflect.ownKeys(value);
    const expected = [...expectedKeys].sort(compareText);
    return (
      actual.length === expected.length &&
      actual.every((key) => typeof key === "string") &&
      actual.sort(compareText).every((key, index) => key === expected[index])
    );
  } catch {
    return false;
  }
}

/** Adds decoded keys or strings to one bounded character budget. */
function addCharacters(budget: SnapshotBudget, count: number, limits: JsonSnapshotLimits): void {
  budget.characters += count;
  if (!Number.isSafeInteger(budget.characters) || budget.characters > limits.maxTotalCharacters) {
    throw createKnowledgeCompilerModelAdapterError("output_too_large");
  }
}

/** Recursively snapshots strict JSON without invoking accessors or retaining proxies. */
function snapshotJsonValue(
  value: unknown,
  limits: JsonSnapshotLimits,
  budget: SnapshotBudget,
  ancestors: Set<object>,
  depth: number
): JsonValue {
  if (depth > limits.maxDepth) {
    throw createKnowledgeCompilerModelAdapterError("output_too_large");
  }
  budget.nodes += 1;
  if (budget.nodes > limits.maxNodes) {
    throw createKnowledgeCompilerModelAdapterError("output_too_large");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    addCharacters(budget, value.length, limits);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw createKnowledgeCompilerModelAdapterError("output_invalid");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw createKnowledgeCompilerModelAdapterError("output_invalid");
  }
  if (ancestors.has(value)) {
    throw createKnowledgeCompilerModelAdapterError("output_invalid");
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
        lengthDescriptor.enumerable ||
        lengthDescriptor.configurable
      ) {
        throw createKnowledgeCompilerModelAdapterError("output_invalid");
      }
      const length = lengthDescriptor.value as number;
      if (length > limits.maxArrayLength) {
        throw createKnowledgeCompilerModelAdapterError("output_too_large");
      }
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== length + 1 || ownKeys.some((key) => typeof key === "symbol")) {
        throw createKnowledgeCompilerModelAdapterError("output_invalid");
      }
      const snapshot: JsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw createKnowledgeCompilerModelAdapterError("output_invalid");
        }
        snapshot.push(snapshotJsonValue(descriptor.value, limits, budget, ancestors, depth + 1));
      }
      return Object.freeze(snapshot) as unknown as JsonValue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw createKnowledgeCompilerModelAdapterError("output_invalid");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw createKnowledgeCompilerModelAdapterError("output_invalid");
    }
    if (keys.length > limits.maxObjectProperties) {
      throw createKnowledgeCompilerModelAdapterError("output_too_large");
    }
    const snapshot = Object.create(null) as Record<string, JsonValue>;
    for (const key of (keys as string[]).sort(compareText)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw createKnowledgeCompilerModelAdapterError("output_invalid");
      }
      addCharacters(budget, key.length, limits);
      Object.defineProperty(snapshot, key, {
        value: snapshotJsonValue(descriptor.value, limits, budget, ancestors, depth + 1),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(snapshot);
  } catch (error) {
    if (KnowledgeCompilerModelAdapterError.inspect(error)) throw error;
    throw createKnowledgeCompilerModelAdapterError("output_invalid");
  } finally {
    ancestors.delete(value);
  }
}

/** Creates one detached deeply frozen bounded JSON snapshot. */
function snapshotJson(value: unknown, limits: JsonSnapshotLimits): JsonValue {
  return snapshotJsonValue(value, limits, { nodes: 0, characters: 0 }, new Set<object>(), 0);
}

/** Decodes bounded provider JSON text before any object-level inspection can trigger callbacks. */
function decodePrivateModelWireOutput(value: unknown): JsonValue {
  if (typeof value !== "string") {
    throw createKnowledgeCompilerModelAdapterError("output_invalid");
  }
  if (value.length > MAX_PRIVATE_MODEL_WIRE_CHARACTERS) {
    throw createKnowledgeCompilerModelAdapterError("output_too_large");
  }
  let bytes: Uint8Array;
  try {
    bytes = new TextEncoder().encode(value);
  } catch {
    throw createKnowledgeCompilerModelAdapterError("output_invalid");
  }
  if (bytes.byteLength > MAX_PRIVATE_MODEL_WIRE_BYTES) {
    throw createKnowledgeCompilerModelAdapterError("output_too_large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw createKnowledgeCompilerModelAdapterError("output_invalid");
  }
  return snapshotJson(parsed, FIXED_KNOWLEDGE_DECODED_MODEL_OUTPUT_LIMITS);
}

/** Captures an exact secret-free model profile used for request and route binding. */
function captureProfile(value: unknown): KnowledgeBundlePipelineProfile {
  let snapshot: JsonValue;
  try {
    snapshot = snapshotJson(value, {
      maxDepth: 32,
      maxNodes: 50_000,
      maxArrayLength: 10_000,
      maxObjectProperties: 1_000,
      maxTotalCharacters: 2_000_000,
    });
    assertKnowledgeConfigurationContainsNoSecrets(
      readOwnDataProperty(readOwnDataProperty(snapshot, "model"), "configuration")
    );
  } catch {
    throw createKnowledgeCompilerModelAdapterError("preparation_invalid");
  }
  return snapshot as unknown as KnowledgeBundlePipelineProfile;
}

/** Captures and validates one exact private route declaration. */
function captureRouteDescriptor(value: unknown): {
  descriptor: Readonly<KnowledgePrivateModelRouteDescriptor>;
  captured: CapturedRouteConfiguration;
} {
  try {
    if (!hasExactKeys(value, ["provider", "model", "configuration"])) {
      throw new TypeError("Unexpected route descriptor shape");
    }
    const provider = requireCanonicalText(readOwnDataProperty(value, "provider"));
    const model = requireCanonicalText(readOwnDataProperty(value, "model"));
    const configuration = snapshotJson(readOwnDataProperty(value, "configuration"), {
      maxDepth: 32,
      maxNodes: 10_000,
      maxArrayLength: 1_000,
      maxObjectProperties: 1_000,
      maxTotalCharacters: 1_000_000,
    });
    assertKnowledgeConfigurationContainsNoSecrets(configuration);
    const behaviorContractVersion = readOwnDataProperty(configuration, "behaviorContractVersion");
    const routeContractVersion = readOwnDataProperty(configuration, "routeContractVersion");
    const adapterPolicy = readOwnDataProperty(configuration, "adapterPolicy");
    const routingPolicy = readOwnDataProperty(configuration, "routingPolicy");
    const structuredOutput = readOwnDataProperty(configuration, "structuredOutput");
    const streaming = readOwnDataProperty(configuration, "streaming");
    const modelFallback = readOwnDataProperty(configuration, "modelFallback");
    if (
      behaviorContractVersion !== SUPPORTED_MODEL_BEHAVIOR_CONTRACT_VERSION ||
      routeContractVersion !== SUPPORTED_PRIVATE_MODEL_ROUTE_CONTRACT_VERSION ||
      adapterPolicy !== MODEL_ADAPTER_POLICY ||
      routingPolicy !== PRIVATE_ROUTING_POLICY ||
      structuredOutput !== KNOWLEDGE_DECODED_MODEL_OUTPUT_CONTRACT ||
      streaming !== false ||
      modelFallback !== false
    ) {
      throw new TypeError("Unsupported route contract");
    }
    const endpointIdentityValue = readOptionalOwnDataProperty(configuration, "endpointIdentity");
    const routingIdentityValue = readOptionalOwnDataProperty(configuration, "routingIdentity");
    const endpointIdentity =
      endpointIdentityValue === undefined ? undefined : requireRouteIdentity(endpointIdentityValue);
    const routingIdentity =
      routingIdentityValue === undefined ? undefined : requireRouteIdentity(routingIdentityValue);
    const configurationDigest = sha256(
      `knowledge-private-model-route-configuration-v1\n${canonicalizeJson(configuration)}`
    );
    return {
      descriptor: Object.freeze({ provider, model, configuration }),
      captured: Object.freeze({
        behaviorContractVersion: SUPPORTED_MODEL_BEHAVIOR_CONTRACT_VERSION,
        routeContractVersion: SUPPORTED_PRIVATE_MODEL_ROUTE_CONTRACT_VERSION,
        adapterPolicy: MODEL_ADAPTER_POLICY,
        routingPolicy: PRIVATE_ROUTING_POLICY,
        structuredOutput: KNOWLEDGE_DECODED_MODEL_OUTPUT_CONTRACT,
        streaming: false,
        modelFallback: false,
        ...(endpointIdentity === undefined ? {} : { endpointIdentity }),
        ...(routingIdentity === undefined ? {} : { routingIdentity }),
        configuration,
        configurationDigest,
      }),
    };
  } catch {
    throw createKnowledgeCompilerModelAdapterError("route_invalid");
  }
}

/** Returns hidden route state only for a module-created route capability. */
function requireRouteState(value: unknown): KnowledgePrivateModelRouteState {
  if (typeof value !== "object" || value === null) {
    throw createKnowledgeCompilerModelAdapterError("route_invalid");
  }
  const state = routeStates.get(value);
  if (!state) {
    throw createKnowledgeCompilerModelAdapterError("route_invalid");
  }
  return state;
}

/** Runs only the classifier captured by the exact opaque route and sanitizes classifier failure. */
function classifyRouteFailure(
  route: KnowledgePrivateModelRouteState,
  error: unknown
): KnowledgePrivateModelProviderFailureCode | undefined {
  if (!route.classifyFailure) return undefined;
  try {
    return REFLECT_APPLY(route.classifyFailure, undefined, [error]);
  } catch {
    return undefined;
  }
}

/** Returns hidden adapter state only for a module-created job-bound adapter. */
function requireAdapterState(value: unknown): KnowledgeCompilerModelAdapterState {
  if (typeof value !== "object" || value === null) {
    throw createKnowledgeCompilerModelAdapterError("adapter_invalid");
  }
  const state = adapterStates.get(value);
  if (!state) {
    throw createKnowledgeCompilerModelAdapterError("adapter_invalid");
  }
  return state;
}

/** Returns canonical JSON for an already detached JSON value. */
function digestJson(domain: string, value: JsonValue): string {
  return sha256(`${domain}\n${canonicalizeJson(value)}`);
}

/** Captures the authentic preparation's exact model-visible request foundation. */
function capturePreparation(preparation: KnowledgeAuthorizedSourcePreparation): {
  signal: AbortSignal;
  profile: KnowledgeBundlePipelineProfile;
  profileDigest: string;
  foundation: AuthorizedPreparationSnapshot;
} {
  try {
    AuthorizedSourcePreparation.assert(preparation);
    const signal = preparation.getSignal();
    const claim = preparation.getClaim();
    const sourcePreparation = preparation.getPreparation();
    const profile = captureProfile(preparation.getProfile());
    const foundation = Object.freeze({
      operation: snapshotJson(readOwnDataProperty(sourcePreparation, "operation"), {
        maxDepth: 1,
        maxNodes: 2,
        maxArrayLength: 1,
        maxObjectProperties: 1,
        maxTotalCharacters: 32,
      }),
      bundle: snapshotJson(readOwnDataProperty(sourcePreparation, "bundle"), {
        maxDepth: 32,
        maxNodes: 50_000,
        maxArrayLength: 10_000,
        maxObjectProperties: 1_000,
        maxTotalCharacters: 2_000_000,
      }),
      source: snapshotJson(readOwnDataProperty(sourcePreparation, "source"), {
        maxDepth: 8,
        maxNodes: 64,
        maxArrayLength: 16,
        maxObjectProperties: 32,
        maxTotalCharacters: 10_000,
      }),
      schema: snapshotJson(readOwnDataProperty(sourcePreparation, "schema"), {
        maxDepth: 8,
        maxNodes: 64,
        maxArrayLength: 16,
        maxObjectProperties: 32,
        maxTotalCharacters: 2_000_000,
      }),
    });
    if (
      readOwnDataProperty(foundation.bundle, "id") !== readOwnDataProperty(claim, "bundleId") ||
      foundation.operation !== "ingest" ||
      readOwnDataProperty(foundation.source, "sourceId") !==
        readOwnDataProperty(claim, "sourceId") ||
      readOwnDataProperty(foundation.source, "sourceContentHash") !==
        readOwnDataProperty(claim, "sourceContentHash") ||
      readOwnDataProperty(foundation.source, "pipelineFingerprint") !==
        readOwnDataProperty(claim, "pipelineFingerprint") ||
      readOwnDataProperty(foundation.source, "inputRevision") !==
        readOwnDataProperty(claim, "inputRevision") ||
      readOwnDataProperty(profile, "bundleId") !== readOwnDataProperty(claim, "bundleId")
    ) {
      throw new TypeError("Preparation identity mismatch");
    }
    return {
      signal,
      profile,
      profileDigest: digestJson(
        "knowledge-authorized-model-profile-v1",
        profile as unknown as JsonValue
      ),
      foundation,
    };
  } catch {
    throw createKnowledgeCompilerModelAdapterError("preparation_invalid");
  }
}

/** Verifies that one route exactly matches the authorized secret-free profile. */
function assertRouteMatchesProfile(
  route: KnowledgePrivateModelRouteState,
  profile: KnowledgeBundlePipelineProfile
): void {
  try {
    const model = readOwnDataProperty(profile, "model");
    const provider = readOwnDataProperty(model, "provider");
    const modelName = readOwnDataProperty(model, "model");
    const configuration = readOwnDataProperty(model, "configuration") as JsonValue;
    const configurationDigest = sha256(
      `knowledge-private-model-route-configuration-v1\n${canonicalizeJson(configuration)}`
    );
    if (
      provider !== route.descriptor.provider ||
      modelName !== route.descriptor.model ||
      configurationDigest !== route.captured.configurationDigest ||
      (route.profileDigest !== undefined &&
        route.profileDigest !==
          digestJson("knowledge-authorized-model-profile-v1", profile as unknown as JsonValue))
    ) {
      throw new TypeError("Route profile mismatch");
    }
  } catch {
    throw createKnowledgeCompilerModelAdapterError("profile_mismatch");
  }
}

/** Snapshots one exact compiler request without trusting its prototype or nested references. */
function snapshotCompilerRequest(
  value: unknown,
  stage: KnowledgePrivateModelStage
): Readonly<CompilerAnalysisRequest | CompilerGenerationRequest> {
  const expectedKeys =
    stage === "analysis"
      ? [
          "version",
          "compileContextDigest",
          "bundle",
          "operation",
          "source",
          "schema",
          "evidence",
          "contextPages",
          "targetAuthorizations",
        ]
      : [
          "version",
          "compileContextDigest",
          "analysisDigest",
          "targetSetDigest",
          "bundle",
          "operation",
          "source",
          "schema",
          "evidence",
          "contextPages",
          "analysis",
          "targets",
        ];
  try {
    const snapshot = snapshotJson(value, {
      maxDepth: 64,
      maxNodes: 200_000,
      maxArrayLength: 20_000,
      maxObjectProperties: 20_000,
      maxTotalCharacters: 16_000_000,
    });
    if (!hasExactKeys(snapshot, expectedKeys)) {
      throw new TypeError("Unexpected request shape");
    }
    if (readOwnDataProperty(snapshot, "version") !== KNOWLEDGE_COMPILER_PROTOCOL_VERSION) {
      throw new TypeError("Invalid protocol version");
    }
    const compileContextDigest = readOwnDataProperty(snapshot, "compileContextDigest");
    if (typeof compileContextDigest !== "string" || !/^[a-f0-9]{64}$/.test(compileContextDigest)) {
      throw new TypeError("Invalid compile-context digest");
    }
    if (
      stage === "generation" &&
      (["analysisDigest", "targetSetDigest"] as const).some((key) => {
        const digest = readOwnDataProperty(snapshot, key);
        return typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest);
      })
    ) {
      throw new TypeError("Invalid generation digest");
    }
    return snapshot as unknown as Readonly<CompilerAnalysisRequest | CompilerGenerationRequest>;
  } catch {
    throw createKnowledgeCompilerModelAdapterError("request_invalid");
  }
}

/** Requires one compiler request to retain the exact authorized source foundation. */
function assertRequestFoundation(
  request: Readonly<CompilerAnalysisRequest | CompilerGenerationRequest>,
  foundation: AuthorizedPreparationSnapshot
): void {
  if (
    request.operation !== foundation.operation ||
    digestJson("knowledge-model-request-bundle-v1", request.bundle as unknown as JsonValue) !==
      digestJson("knowledge-model-request-bundle-v1", foundation.bundle) ||
    digestJson("knowledge-model-request-source-v1", request.source as unknown as JsonValue) !==
      digestJson("knowledge-model-request-source-v1", foundation.source) ||
    digestJson("knowledge-model-request-schema-v1", request.schema as unknown as JsonValue) !==
      digestJson("knowledge-model-request-schema-v1", foundation.schema)
  ) {
    throw createKnowledgeCompilerModelAdapterError("request_not_authorized");
  }
}

/** Requires generation to retain the exact first-stage evidence and context authority. */
function assertGenerationCrossStageAuthority(
  generation: CompilerGenerationRequest,
  analysisRequest: CompilerAnalysisRequest
): void {
  if (
    generation.compileContextDigest !== analysisRequest.compileContextDigest ||
    digestJson(
      "knowledge-model-cross-stage-evidence-v1",
      generation.evidence as unknown as JsonValue
    ) !==
      digestJson(
        "knowledge-model-cross-stage-evidence-v1",
        analysisRequest.evidence as unknown as JsonValue
      ) ||
    digestJson(
      "knowledge-model-cross-stage-context-v1",
      generation.contextPages as unknown as JsonValue
    ) !==
      digestJson(
        "knowledge-model-cross-stage-context-v1",
        analysisRequest.contextPages as unknown as JsonValue
      )
  ) {
    throw createKnowledgeCompilerModelAdapterError("request_not_authorized");
  }
}

/** Snapshots and verifies one exact compiler request against retained call authority. */
function captureAuthorizedRequest(
  value: unknown,
  stage: KnowledgePrivateModelStage,
  state: KnowledgeCompilerModelAdapterState
): Readonly<CompilerAnalysisRequest | CompilerGenerationRequest> {
  const authorization =
    stage === "analysis" ? state.analysisAuthorization : state.generationAuthorization;
  if (
    !authorization ||
    typeof value !== "object" ||
    value === null ||
    value !== authorization.requestIdentity
  ) {
    throw createKnowledgeCompilerModelAdapterError(
      stage === "analysis" ? "request_not_authorized" : "generation_not_authorized"
    );
  }
  const request = snapshotCompilerRequest(value, stage);
  assertRequestFoundation(request, state.foundation);
  const domain =
    stage === "analysis"
      ? "knowledge-authorized-analysis-request-v1"
      : "knowledge-authorized-generation-request-v1";
  if (digestJson(domain, request as unknown as JsonValue) !== authorization.requestDigest) {
    throw createKnowledgeCompilerModelAdapterError(
      stage === "analysis" ? "request_not_authorized" : "generation_not_authorized"
    );
  }
  if (stage === "generation") {
    const analysisAuthorization = state.analysisAuthorization;
    if (!analysisAuthorization) {
      throw createKnowledgeCompilerModelAdapterError("generation_not_authorized");
    }
    assertGenerationCrossStageAuthority(
      request as CompilerGenerationRequest,
      analysisAuthorization.request
    );
  }
  return request;
}

/** Projects normalized analysis into the exact model-visible generation shape. */
function projectGenerationAnalysis(analysis: CompilerAnalysis): JsonValue {
  return {
    version: analysis.version,
    summary: analysis.summary,
    concepts: analysis.concepts as unknown as JsonValue,
    entities: analysis.entities as unknown as JsonValue,
    claims: analysis.claims as unknown as JsonValue,
    relations: analysis.relations as unknown as JsonValue,
    citations: analysis.citations as unknown as JsonValue,
  };
}

/** Projects bound targets into the exact digest material used by the compiler core. */
function projectTargetSet(targets: readonly CompilerBoundTarget[]): JsonValue {
  return targets.map((target) => ({
    targetId: target.targetId,
    path: target.path,
    intent: target.intent,
    operation: target.operation,
    reason: target.reason,
    claimIds: target.claimIds,
    sourceRefs: target.sourceRefs,
    access: target.access,
    contentPolicy: target.contentPolicy,
    ownership: target.ownership,
    ...(target.expectedContentHash === undefined
      ? {}
      : { expectedContentHash: target.expectedContentHash }),
    ...(target.operation === "create" ? {} : { beforeHash: target.beforeHash }),
  }));
}

/** Projects writable bound targets into the exact second-stage request shape. */
function projectGenerationTargets(targets: readonly CompilerBoundTarget[]): JsonValue {
  return targets
    .filter((target) => target.operation !== "delete")
    .map((target) => ({
      targetId: target.targetId,
      path: target.path,
      reason: target.reason,
      claimIds: target.claimIds,
      contentPolicy: target.contentPolicy,
      operation: target.operation,
      ...(target.operation === "update" ? { currentContent: target.beforeContent } : {}),
    }));
}

/** Consumes and captures one exact compiler-issued first-stage call. */
function authorizeAnalysisModelCall(
  state: KnowledgeCompilerModelAdapterState,
  authorization: unknown
): void {
  state.analysisState = "validating";
  try {
    const call = KnowledgeCompilerModelCallAuthorization.consume(authorization, "analysis");
    KnowledgeCompilerModelSession.assert(call.session);
    if (call.signal !== state.signal) {
      throw createKnowledgeCompilerModelAdapterError("signal_mismatch");
    }
    if (state.signal.aborted) throw createAbortError();
    if (typeof call.request !== "object" || call.request === null) {
      throw createKnowledgeCompilerModelAdapterError("request_not_authorized");
    }
    const request = snapshotCompilerRequest(call.request, "analysis") as CompilerAnalysisRequest;
    assertRequestFoundation(request, state.foundation);
    state.analysisAuthorization = Object.freeze({
      requestIdentity: call.request,
      request,
      requestDigest: digestJson(
        "knowledge-authorized-analysis-request-v1",
        request as unknown as JsonValue
      ),
    });
    state.modelSession = call.session;
    state.analysisState = "available";
  } catch (error) {
    state.analysisState = "failed";
    if (state.signal.aborted) throw createAbortError();
    if (KnowledgeCompilerModelAdapterError.inspect(error)?.code === "signal_mismatch") {
      throw error;
    }
    throw createKnowledgeCompilerModelAdapterError("request_not_authorized");
  }
}

/** Consumes and verifies the compiler's exact normalized second-stage call state. */
function authorizeGenerationModelCall(
  state: KnowledgeCompilerModelAdapterState,
  authorization: unknown
): void {
  state.generationState = "validating";
  try {
    const call = KnowledgeCompilerModelCallAuthorization.consume(authorization, "generation");
    KnowledgeCompilerModelSession.assert(call.session);
    if (call.signal !== state.signal) {
      throw createKnowledgeCompilerModelAdapterError("signal_mismatch");
    }
    if (state.signal.aborted) throw createAbortError();
    if (
      state.analysisOutput === undefined ||
      state.analysisOutputDigest === undefined ||
      state.modelSession === undefined ||
      call.session !== state.modelSession ||
      call.rawAnalysis !== state.analysisOutput ||
      typeof call.request !== "object" ||
      call.request === null
    ) {
      throw createKnowledgeCompilerModelAdapterError("generation_not_authorized");
    }
    const analysis = snapshotJson(call.analysis, {
      maxDepth: 64,
      maxNodes: 200_000,
      maxArrayLength: 20_000,
      maxObjectProperties: 20_000,
      maxTotalCharacters: 16_000_000,
    }) as unknown as CompilerAnalysis;
    const targets = snapshotJson(call.targets, {
      maxDepth: 32,
      maxNodes: 100_000,
      maxArrayLength: 20_000,
      maxObjectProperties: 64,
      maxTotalCharacters: 16_000_000,
    }) as unknown as readonly CompilerBoundTarget[];
    if (!Array.isArray(targets)) {
      throw createKnowledgeCompilerModelAdapterError("generation_not_authorized");
    }
    const request = snapshotCompilerRequest(
      call.request,
      "generation"
    ) as CompilerGenerationRequest;
    assertRequestFoundation(request, state.foundation);
    const analysisAuthorization = state.analysisAuthorization;
    if (!analysisAuthorization) {
      throw createKnowledgeCompilerModelAdapterError("generation_not_authorized");
    }
    assertGenerationCrossStageAuthority(request, analysisAuthorization.request);
    const analysisDigest = digestJson("knowledge-analysis-v1", analysis as unknown as JsonValue);
    const targetSetDigest = digestJson("knowledge-target-set-v1", {
      compileContextDigest: request.compileContextDigest,
      analysisDigest,
      targets: projectTargetSet(targets),
    });
    if (
      request.analysisDigest !== analysisDigest ||
      request.targetSetDigest !== targetSetDigest ||
      digestJson("knowledge-generation-analysis-v1", request.analysis as unknown as JsonValue) !==
        digestJson("knowledge-generation-analysis-v1", projectGenerationAnalysis(analysis)) ||
      digestJson("knowledge-generation-targets-v1", request.targets) !==
        digestJson("knowledge-generation-targets-v1", projectGenerationTargets(targets)) ||
      digestJson("knowledge-analysis-output-v1", state.analysisOutput) !==
        state.analysisOutputDigest
    ) {
      throw createKnowledgeCompilerModelAdapterError("generation_not_authorized");
    }
    state.generationAuthorization = Object.freeze({
      requestIdentity: call.request,
      request,
      requestDigest: digestJson(
        "knowledge-authorized-generation-request-v1",
        request as unknown as JsonValue
      ),
      analysisDigest,
      targetSetDigest,
    });
    state.generationState = "available";
  } catch (error) {
    state.generationState = "failed";
    if (state.signal.aborted) throw createAbortError();
    if (KnowledgeCompilerModelAdapterError.inspect(error)?.code === "signal_mismatch") {
      throw error;
    }
    throw createKnowledgeCompilerModelAdapterError("generation_not_authorized");
  }
}

/** Accepts only the one-shot compiler authorization appropriate for the next stage. */
function authorizeCompilerModelCall(
  state: KnowledgeCompilerModelAdapterState,
  authorization: unknown
): void {
  if (state.signal.aborted) throw createAbortError();
  if (state.analysisState === "unavailable" && state.generationState === "unavailable") {
    authorizeAnalysisModelCall(state, authorization);
    return;
  }
  if (state.analysisState === "completed" && state.generationState === "unavailable") {
    authorizeGenerationModelCall(state, authorization);
    return;
  }
  throw createKnowledgeCompilerModelAdapterError("stage_invalid");
}

/** Revalidates the exact preparation, signal, profile, and Runtime proof. */
async function reprove(
  state: KnowledgeCompilerModelAdapterState,
  stage: "analyzing" | "generating"
): Promise<void> {
  try {
    AuthorizedSourcePreparation.assert(state.preparation);
    if (state.signal.aborted) throw createAbortError();
    if (state.preparation.getSignal() !== state.signal) {
      throw createKnowledgeCompilerModelAdapterError("signal_mismatch");
    }
    let currentProfile: KnowledgeBundlePipelineProfile;
    try {
      currentProfile = captureProfile(state.preparation.getProfile());
    } catch {
      throw createKnowledgeCompilerModelAdapterError("profile_mismatch");
    }
    if (
      digestJson(
        "knowledge-authorized-model-profile-v1",
        currentProfile as unknown as JsonValue
      ) !== state.profileDigest
    ) {
      throw createKnowledgeCompilerModelAdapterError("profile_mismatch");
    }
    await state.preparation.reprove(stage);
    if (state.signal.aborted) throw createAbortError();
  } catch (error) {
    if (state.signal.aborted) throw createAbortError();
    if (KnowledgeCompilerModelAdapterError.inspect(error)) throw error;
    throw createKnowledgeCompilerModelAdapterError("authority_stale");
  }
}

/** Reports one Queue stage without retaining infrastructure failures. */
async function reportStage(
  state: KnowledgeCompilerModelAdapterState,
  stage: "analyzing" | "generating"
): Promise<void> {
  try {
    await REFLECT_APPLY(state.reportStage, undefined, [stage]);
  } catch {
    if (state.signal.aborted) throw createAbortError();
    throw createKnowledgeCompilerModelAdapterError("stage_invalid");
  }
}

/** Executes one authorized, single-use private route invocation. */
async function invokeModel(
  state: KnowledgeCompilerModelAdapterState,
  modelStage: KnowledgePrivateModelStage,
  requestValue: unknown,
  signal: AbortSignal
): Promise<unknown> {
  const queueStage = modelStage === "analysis" ? "analyzing" : "generating";
  if (signal !== state.signal) {
    throw createKnowledgeCompilerModelAdapterError("signal_mismatch");
  }
  if (state.signal.aborted) throw createAbortError();
  if (modelStage === "analysis") {
    if (state.analysisState === "unavailable") {
      throw createKnowledgeCompilerModelAdapterError("request_not_authorized");
    }
    if (state.analysisState !== "available") {
      throw createKnowledgeCompilerModelAdapterError("stage_invalid");
    }
    state.analysisState = "validating";
  } else {
    if (
      state.analysisState !== "completed" ||
      state.generationState !== "available" ||
      !state.generationAuthorization
    ) {
      throw createKnowledgeCompilerModelAdapterError("generation_not_authorized");
    }
    state.generationState = "validating";
  }
  let request: Readonly<CompilerAnalysisRequest | CompilerGenerationRequest>;
  try {
    assertRouteMatchesProfile(state.route, state.profile);
    request = captureAuthorizedRequest(requestValue, modelStage, state);
  } catch (error) {
    if (modelStage === "analysis") {
      state.analysisState = "failed";
    } else {
      state.generationState = "failed";
    }
    if (KnowledgeCompilerModelAdapterError.inspect(error)) throw error;
    throw createKnowledgeCompilerModelAdapterError("request_invalid");
  }
  if (modelStage === "analysis") {
    state.analysisState = "running";
  } else {
    state.generationState = "running";
  }
  try {
    await reportStage(state, queueStage);
    await reprove(state, queueStage);
    let raw: string;
    try {
      raw = await REFLECT_APPLY(state.route.invoke, undefined, [modelStage, request, state.signal]);
    } catch (error) {
      if (state.signal.aborted) throw createAbortError();
      throw createKnowledgeCompilerModelAdapterError(
        "route_failed",
        classifyRouteFailure(state.route, error)
      );
    }
    if (state.signal.aborted) throw createAbortError();
    const output = decodePrivateModelWireOutput(raw);
    if (typeof output !== "object" || output === null || Array.isArray(output)) {
      throw createKnowledgeCompilerModelAdapterError("output_invalid");
    }
    const structurallyValid =
      modelStage === "analysis"
        ? parseCompilerAnalysisModelOutput(output).ok
        : parseCompilerGenerationModelOutput(output).ok;
    if (!structurallyValid) {
      throw createKnowledgeCompilerModelAdapterError("output_invalid");
    }
    await reprove(state, queueStage);
    if (modelStage === "analysis") {
      state.analysisOutput = output;
      state.analysisOutputDigest = digestJson("knowledge-analysis-output-v1", output);
      state.analysisState = "completed";
    } else {
      state.generationState = "completed";
    }
    return output;
  } catch (error) {
    if (modelStage === "analysis") {
      state.analysisState = "failed";
    } else {
      state.generationState = "failed";
    }
    if (state.signal.aborted) throw createAbortError();
    if (KnowledgeCompilerModelAdapterError.inspect(error)) throw error;
    throw createKnowledgeCompilerModelAdapterError("route_failed");
  }
}

/**
 * Opaque private route capability whose credential and transport live only in a closure.
 *
 * The class deliberately exposes no invoke method. Only the job-bound adapter in
 * this module can reach the closure after exact profile and execution reproof.
 */
export class KnowledgePrivateModelRoute {
  /** Rejects direct construction without the module-private provider-factory token. */
  constructor(
    token: symbol,
    descriptor: KnowledgePrivateModelRouteDescriptor,
    invoke: KnowledgePrivateModelInvoke,
    classifyFailure?: KnowledgePrivateModelFailureClassifier,
    profileDigest?: string
  ) {
    if (
      token !== ROUTE_TOKEN ||
      typeof invoke !== "function" ||
      (classifyFailure !== undefined && typeof classifyFailure !== "function") ||
      (profileDigest !== undefined && !/^[a-f0-9]{64}$/.test(profileDigest))
    ) {
      throw createKnowledgeCompilerModelAdapterError("route_invalid");
    }
    const captured = captureRouteDescriptor(descriptor);
    routeStates.set(
      this,
      Object.freeze({
        descriptor: captured.descriptor,
        captured: captured.captured,
        invoke,
        ...(classifyFailure === undefined ? {} : { classifyFailure }),
        ...(profileDigest === undefined ? {} : { profileDigest }),
      })
    );
    Object.freeze(this);
  }

  /** Rejects spread copies, prototype forgeries, and ordinary descriptor DTOs. */
  static assert(value: unknown): asserts value is KnowledgePrivateModelRoute {
    requireRouteState(value);
  }

  /** Returns the detached secret-free declaration for diagnostics and composition. */
  getDescriptor(): Readonly<KnowledgePrivateModelRouteDescriptor> {
    return requireRouteState(this).descriptor;
  }

  /** Returns whether this exact route was sealed for one secret-free pipeline profile. */
  matchesProfile(profile: KnowledgeBundlePipelineProfile): boolean {
    try {
      assertRouteMatchesProfile(requireRouteState(this), profile);
      return true;
    } catch {
      return false;
    }
  }
}

Object.freeze(KnowledgePrivateModelRoute.prototype);
Object.freeze(KnowledgePrivateModelRoute);

/**
 * Seals one reviewed provider transport behind an opaque route capability.
 *
 * Concrete provider modules remain responsible for constructing one exact,
 * non-streaming, no-fallback transport call and returning bounded JSON text.
 */
export function bindKnowledgePrivateModelRoute(
  descriptor: KnowledgePrivateModelRouteDescriptor,
  invoke: KnowledgePrivateModelInvoke,
  classifyFailure?: KnowledgePrivateModelFailureClassifier
): KnowledgePrivateModelRoute {
  return new KnowledgePrivateModelRoute(ROUTE_TOKEN, descriptor, invoke, classifyFailure);
}

/**
 * Seals a private provider route to one complete secret-free pipeline profile.
 *
 * Concrete transports should prefer this binder whenever prompt behavior is
 * derived from profile fields outside the model configuration. The adapter
 * then rejects reuse with another output language, compiler, parser, or
 * citation contract even when the provider/model pair is otherwise identical.
 */
export function bindKnowledgePrivateModelRouteToProfile(
  profile: KnowledgeBundlePipelineProfile,
  invoke: KnowledgePrivateModelInvoke,
  classifyFailure?: KnowledgePrivateModelFailureClassifier
): KnowledgePrivateModelRoute {
  try {
    const capturedProfile = captureProfile(profile);
    const model = readOwnDataProperty(capturedProfile, "model");
    const descriptor: KnowledgePrivateModelRouteDescriptor = {
      provider: requireCanonicalText(readOwnDataProperty(model, "provider")),
      model: requireCanonicalText(readOwnDataProperty(model, "model")),
      configuration: readOwnDataProperty(model, "configuration") as JsonValue,
    };
    return new KnowledgePrivateModelRoute(
      ROUTE_TOKEN,
      descriptor,
      invoke,
      classifyFailure,
      digestJson("knowledge-authorized-model-profile-v1", capturedProfile as unknown as JsonValue)
    );
  } catch (error) {
    if (KnowledgeCompilerModelAdapterError.inspect(error)?.code === "route_invalid") {
      throw error;
    }
    throw createKnowledgeCompilerModelAdapterError("route_invalid");
  }
}

/**
 * Single-attempt CompilerModelPort bound to an authentic source preparation and Queue signal.
 */
export class KnowledgeCompilerModelAdapter implements CompilerModelPort {
  /** Binds exact preparation, private route, and Queue stage capability without own fields. */
  constructor(
    token: symbol,
    preparation: KnowledgeAuthorizedSourcePreparation,
    route: KnowledgePrivateModelRoute,
    reportStageValue: KnowledgeModelStageReporter
  ) {
    if (token !== ADAPTER_TOKEN || typeof reportStageValue !== "function") {
      throw createKnowledgeCompilerModelAdapterError("adapter_invalid");
    }
    const authorized = capturePreparation(preparation);
    const routeState = requireRouteState(route);
    assertRouteMatchesProfile(routeState, authorized.profile);
    if (reservedAdapterPreparations.has(preparation)) {
      throw createKnowledgeCompilerModelAdapterError("preparation_reused");
    }
    reservedAdapterPreparations.add(preparation);
    adapterStates.set(this, {
      preparation,
      signal: authorized.signal,
      profile: authorized.profile,
      profileDigest: authorized.profileDigest,
      foundation: authorized.foundation,
      route: routeState,
      reportStage: reportStageValue,
      analysisState: "unavailable",
      generationState: "unavailable",
    });
    Object.freeze(this);
  }

  /** Requires an authentic binder-created adapter instance. */
  static assert(value: unknown): asserts value is KnowledgeCompilerModelAdapter {
    requireAdapterState(value);
  }

  /** Consumes the exact one-shot compiler authorization for the next model stage. */
  authorizeModelCall(authorization: unknown): void {
    authorizeCompilerModelCall(requireAdapterState(this), authorization);
  }

  /** Executes the one permitted analysis call through the exact private route. */
  async analyze(request: CompilerAnalysisRequest, signal: AbortSignal): Promise<unknown> {
    return invokeModel(requireAdapterState(this), "analysis", request, signal);
  }

  /** Executes the one permitted generation call after successful analysis. */
  async generate(request: CompilerGenerationRequest, signal: AbortSignal): Promise<unknown> {
    return invokeModel(requireAdapterState(this), "generation", request, signal);
  }
}

Object.freeze(KnowledgeCompilerModelAdapter.prototype);
Object.freeze(KnowledgeCompilerModelAdapter);

/**
 * Classifies only sanitized failures created by this model boundary.
 *
 * The returned value contains no provider payload, request, URL, credential,
 * or original cause. Queue policy remains responsible for scheduling retries.
 *
 * @param error - Opaque rejection caught by the Compiler
 * @returns Provider-neutral retry facts, or undefined for an unrelated error
 */
export function classifyKnowledgeCompilerModelAdapterFailure(
  error: unknown
): KnowledgeCompilerInfrastructureFailureCode | undefined {
  const state = KnowledgeCompilerModelAdapterError.inspect(error);
  if (!state) return undefined;

  switch (state.providerFailure) {
    case "rate_limited":
      return "provider_rate_limited";
    case "provider_unavailable":
      return "provider_unavailable";
    case "network_failed":
      return "provider_network_failed";
    case "unauthorized":
      return "provider_unauthorized";
    case "insufficient_balance":
      return "provider_balance_required";
    case "request_rejected":
    case "request_too_large":
      return "provider_request_rejected";
    case "response_too_large":
    case "response_invalid":
      return "provider_response_invalid";
    case "http_failed":
      return "provider_http_failed";
  }

  if (state.code === "output_invalid" || state.code === "output_too_large") {
    return "model_output_invalid";
  }
  return "model_authority_failed";
}

/** Creates job-bound adapters while keeping the constructor token module-private. */
export function bindKnowledgeCompilerModelAdapter(
  preparation: KnowledgeAuthorizedSourcePreparation,
  route: KnowledgePrivateModelRoute,
  reportStage: KnowledgeModelStageReporter
): KnowledgeCompilerModelAdapter {
  return new KnowledgeCompilerModelAdapter(ADAPTER_TOKEN, preparation, route, reportStage);
}
