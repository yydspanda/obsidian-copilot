import {
  isCurrentDeepSeekModelIdentity,
  resolveDeepSeekWireModelIdentity,
} from "@/LLMProviders/deepseekModelPolicy";
import {
  createKnowledgeDeepSeekPrivateRoute,
  createKnowledgeDeepSeekGroundedAnswerModelRoute,
  KnowledgeDeepSeekTransportError,
  type KnowledgeDeepSeekFetchPort,
} from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import {
  createKnowledgeProductionModelRouteLeaseOwner,
  type KnowledgeProductionModelRouteBinding,
  KnowledgeProductionModelRouteLeaseOwner,
} from "@/knowledge/compiler/KnowledgeProductionModelRouteLease";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import {
  ProjectKnowledgePipelineProfileError,
  ProjectKnowledgePipelineProfileSource,
  type ProjectKnowledgePipelineProfileErrorCode,
  type ProjectKnowledgePipelineProfileSourceOptions,
  type ProjectKnowledgePipelineProjectInput,
  type ProjectKnowledgePipelineSettingsInput,
} from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import type { KnowledgeBundlePipelineProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";

const MAX_GENERATION_RECORDS = 10_000;

// Capturing the frozen base method prevents an authentic subclass from replacing the WeakMap check.
// eslint-disable-next-line @typescript-eslint/unbound-method -- capture the frozen base method before any subclass can replace the WeakMap check
const PROJECT_PROFILE_SOURCE_RESOLVE = ProjectKnowledgePipelineProfileSource.prototype.resolve;

/** Hydrated settings projection consumed by one production Knowledge generation. */
export interface KnowledgeProductionPreflightSettingsInput extends ProjectKnowledgePipelineSettingsInput {
  /** Hydrated provider credential used only when the selected model has no credential. */
  deepseekApiKey: unknown;
}

/** One-shot production input whose sensitive capabilities are validated and then discarded. */
export interface KnowledgeProductionPreflightComposerInput {
  /** Aggregate, strictly configured Bundle owners from the startup barrier. */
  owners: readonly ConfiguredProjectKnowledgeBundle[];
  /** Project records captured from the same Projects generation as the owners. */
  projects: readonly ProjectKnowledgePipelineProjectInput[];
  /** Already hydrated settings; this composer never reads the keychain itself. */
  settings: KnowledgeProductionPreflightSettingsInput;
  /** Static compiler, parser, prompt, provider, and output behavior. */
  profileOptions: ProjectKnowledgePipelineProfileSourceOptions;
  /**
   * Optional authentic secret-free profile source shared with the plugin workflow lease.
   *
   * Direct Core callers may omit this field and let the composer capture one from
   * `projects`, `settings`, and `profileOptions`. Production plugin composition
   * supplies the exact instance retained by its generation-owned workflow lease.
   */
  profileSource?: ProjectKnowledgePipelineProfileSource;
  /** Native renderer fetch capability passed through route construction but never called. */
  fetchPort: KnowledgeDeepSeekFetchPort;
}

/** Stable credential-free diagnostic categories returned by production preflight. */
export type KnowledgeProductionPreflightDiagnosticCode =
  | "closed"
  | "input_invalid"
  | "bundle_duplicate"
  | "model_unsupported"
  | `profile_${ProjectKnowledgePipelineProfileErrorCode}`
  | "route_dependency_invalid"
  | "route_profile_invalid"
  | "route_model_unsupported"
  | "route_configuration_unsupported"
  | "route_endpoint_mismatch"
  | "route_credential_invalid"
  | "route_invalid";

/** Secret-free status snapshot exposed to the startup and Studio adapters. */
export type KnowledgeProductionPreflightResult =
  | Readonly<{
      kind: "ready";
      bundleCount: number;
    }>
  | Readonly<{
      kind: "diagnostic";
      code: KnowledgeProductionPreflightDiagnosticCode;
    }>;

interface KnowledgeProductionPreflightComposerState {
  result: KnowledgeProductionPreflightResult;
  routeOwner?: KnowledgeProductionModelRouteLeaseOwner;
}

/** Internal static failure used without retaining an input value or cause. */
class KnowledgeProductionPreflightFailure extends TypeError {
  /** Creates one credential-free preflight failure. */
  constructor(public readonly code: KnowledgeProductionPreflightDiagnosticCode) {
    super("The production Knowledge preflight failed");
    this.name = "KnowledgeProductionPreflightFailure";
  }
}

const composerStates = new WeakMap<object, KnowledgeProductionPreflightComposerState>();

const CLOSED_RESULT: KnowledgeProductionPreflightResult = Object.freeze({
  kind: "diagnostic",
  code: "closed",
});

const INVALID_RESULT: KnowledgeProductionPreflightResult = Object.freeze({
  kind: "diagnostic",
  code: "input_invalid",
});

const CLOSED_STATE: KnowledgeProductionPreflightComposerState = Object.freeze({
  result: CLOSED_RESULT,
});

/** Reads an enumerable own data property without invoking an accessor. */
function readDataProperty(value: unknown, key: string): unknown {
  try {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
      throw new TypeError("Expected an object");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Expected an own data property");
    }
    return descriptor.value;
  } catch {
    throw new KnowledgeProductionPreflightFailure("input_invalid");
  }
}

/**
 * Resolves the authentic profile source used by one preflight generation.
 *
 * A supplied source is never replaced by the independently captured baseline:
 * production relies on object identity to bind preflight to its workflow lease.
 * Calling `resolve` later also re-proves the source's module-private WeakMap
 * authority, so a prototype-forged instance still fails closed.
 */
function resolveProfileSource(
  input: KnowledgeProductionPreflightComposerInput,
  baseline: ProjectKnowledgePipelineProfileSource
): ProjectKnowledgePipelineProfileSource {
  const descriptor = Object.getOwnPropertyDescriptor(input, "profileSource");
  if (descriptor) {
    if (
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !(descriptor.value instanceof ProjectKnowledgePipelineProfileSource)
    ) {
      throw new KnowledgeProductionPreflightFailure("input_invalid");
    }
    return descriptor.value;
  }
  return baseline;
}

/**
 * Re-proves that a shared authentic source describes this exact input snapshot.
 *
 * The shared object identity remains available to the workflow lease, while an
 * independently captured baseline prevents a valid source from another plugin
 * generation from authorizing different project, settings, or static behavior.
 */
function assertProfileMatchesBaseline(
  profile: KnowledgeBundlePipelineProfile,
  baselineSource: ProjectKnowledgePipelineProfileSource,
  owner: ConfiguredProjectKnowledgeBundle
): void {
  try {
    const baselineProfile = resolveProfile(baselineSource, owner);
    if (
      canonicalizeJson(profile as unknown as JsonValue) !==
      canonicalizeJson(baselineProfile as unknown as JsonValue)
    ) {
      throw new TypeError("The shared profile source does not match the input snapshot");
    }
  } catch {
    throw new KnowledgeProductionPreflightFailure("input_invalid");
  }
}

/** Resolves through the frozen base implementation so subclass overrides cannot bypass authority. */
function resolveProfile(
  source: ProjectKnowledgePipelineProfileSource,
  owner: ConfiguredProjectKnowledgeBundle
): KnowledgeBundlePipelineProfile {
  return Reflect.apply(PROJECT_PROFILE_SOURCE_RESOLVE, source, [owner]);
}

/** Reads one optional model credential without evaluating accessors. */
function readOptionalModelCredential(value: unknown): unknown {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("Expected a model record");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, "apiKey");
    if (!descriptor) return undefined;
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Expected a credential data property");
    }
    return descriptor.value;
  } catch {
    throw new KnowledgeProductionPreflightFailure("route_credential_invalid");
  }
}

/** Reads the hydrated provider credential without evaluating accessors. */
function readProviderCredential(settings: unknown): unknown {
  try {
    if (typeof settings !== "object" || settings === null) {
      throw new TypeError("Expected settings");
    }
    const descriptor = Object.getOwnPropertyDescriptor(settings, "deepseekApiKey");
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Expected a hydrated credential data property");
    }
    return descriptor.value;
  } catch {
    throw new KnowledgeProductionPreflightFailure("route_credential_invalid");
  }
}

/** Captures a bounded dense array without consulting iterator hooks. */
function snapshotDenseArray(value: unknown): readonly unknown[] {
  try {
    if (!Array.isArray(value)) {
      throw new TypeError("Expected an array");
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_GENERATION_RECORDS ||
      Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
    ) {
      throw new TypeError("Expected a bounded dense array");
    }
    const snapshot: unknown[] = [];
    for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Expected an array data property");
      }
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch (error) {
    if (error instanceof KnowledgeProductionPreflightFailure) throw error;
    throw new KnowledgeProductionPreflightFailure("input_invalid");
  }
}

/** Reads a canonical identity from a model record without coercion or trimming. */
function readModelIdentity(value: unknown, key: "name" | "provider"): string {
  const candidate = readDataProperty(value, key);
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.trim() !== candidate) {
    throw new KnowledgeProductionPreflightFailure("input_invalid");
  }
  return candidate;
}

/** Selects the exact model credential, falling back only when it is absent or empty. */
function selectCredential(
  settings: KnowledgeProductionPreflightSettingsInput,
  profile: KnowledgeBundlePipelineProfile
): string {
  const activeModels = snapshotDenseArray(readDataProperty(settings, "activeModels"));
  const matches = activeModels.filter((model) => {
    const provider = readModelIdentity(model, "provider");
    const modelIdentity = readModelIdentity(model, "name");
    if (provider !== profile.model.provider) return false;
    // The profile stores the canonical wire identity, while the exact model
    // record selected earlier may still retain DeepSeek's persisted Flash alias.
    // https://github.com/yydspanda/obsidian-copilot/issues/3
    const credentialIdentity =
      provider === "deepseek" ? resolveDeepSeekWireModelIdentity(modelIdentity) : modelIdentity;
    return credentialIdentity === profile.model.model;
  });
  if (matches.length !== 1) {
    throw new KnowledgeProductionPreflightFailure("input_invalid");
  }
  const modelCredential = readOptionalModelCredential(matches[0]);
  const selected =
    modelCredential === undefined || modelCredential === ""
      ? readProviderCredential(settings)
      : modelCredential;
  if (typeof selected !== "string") {
    throw new KnowledgeProductionPreflightFailure("route_credential_invalid");
  }
  return selected;
}

/** Maps a caught construction failure to a closed public diagnostic vocabulary. */
function classifyPreflightFailure(error: unknown): KnowledgeProductionPreflightDiagnosticCode {
  if (error instanceof KnowledgeProductionPreflightFailure) return error.code;
  const profileCode = ProjectKnowledgePipelineProfileError.inspect(error);
  if (profileCode !== undefined) return `profile_${profileCode}`;
  const deepSeekCode = KnowledgeDeepSeekTransportError.inspect(error);
  if (deepSeekCode !== undefined) {
    switch (deepSeekCode) {
      case "dependency_invalid":
      case "profile_invalid":
      case "model_unsupported":
      case "configuration_unsupported":
      case "endpoint_mismatch":
      case "credential_invalid":
        return `route_${deepSeekCode}`;
      default:
        return "route_invalid";
    }
  }
  return "input_invalid";
}

/** Creates one frozen public diagnostic without retaining a caught error. */
function createDiagnosticState(
  code: KnowledgeProductionPreflightDiagnosticCode
): KnowledgeProductionPreflightComposerState {
  return Object.freeze({
    result: Object.freeze({ kind: "diagnostic" as const, code }),
  });
}

/** Eagerly composes and validates private routes without invoking a transport. */
function composeGeneration(
  input: KnowledgeProductionPreflightComposerInput
): KnowledgeProductionPreflightComposerState {
  try {
    const owners = snapshotDenseArray(readDataProperty(input, "owners"));
    const projects = snapshotDenseArray(readDataProperty(input, "projects"));
    const settings = readDataProperty(input, "settings");
    const profileOptions = readDataProperty(input, "profileOptions");
    const fetchPort = readDataProperty(input, "fetchPort");
    if (owners.length === 0) {
      throw new KnowledgeProductionPreflightFailure("input_invalid");
    }
    if (typeof settings !== "object" || settings === null) {
      throw new KnowledgeProductionPreflightFailure("input_invalid");
    }
    if (typeof profileOptions !== "object" || profileOptions === null) {
      throw new KnowledgeProductionPreflightFailure("input_invalid");
    }
    if (typeof fetchPort !== "function") {
      throw new KnowledgeProductionPreflightFailure("route_dependency_invalid");
    }

    const baselineProfileSource = new ProjectKnowledgePipelineProfileSource(
      projects as readonly ProjectKnowledgePipelineProjectInput[],
      settings as KnowledgeProductionPreflightSettingsInput,
      profileOptions as ProjectKnowledgePipelineProfileSourceOptions
    );
    const profileSource = resolveProfileSource(input, baselineProfileSource);
    let bundleCount = 0;
    const bundleIds = new Set<string>();
    const routeBindings: KnowledgeProductionModelRouteBinding[] = [];
    for (const owner of owners as readonly ConfiguredProjectKnowledgeBundle[]) {
      const profile = resolveProfile(profileSource, owner);
      if (profileSource !== baselineProfileSource) {
        assertProfileMatchesBaseline(profile, baselineProfileSource, owner);
      }
      if (
        profile.model.provider !== "deepseek" ||
        !isCurrentDeepSeekModelIdentity(profile.model.model)
      ) {
        throw new KnowledgeProductionPreflightFailure("model_unsupported");
      }
      if (bundleIds.has(profile.bundleId)) {
        throw new KnowledgeProductionPreflightFailure("bundle_duplicate");
      }
      const credential = selectCredential(
        settings as KnowledgeProductionPreflightSettingsInput,
        profile
      );
      const route = createKnowledgeDeepSeekPrivateRoute(
        profile,
        credential,
        fetchPort as KnowledgeDeepSeekFetchPort
      );
      const answerRoute = createKnowledgeDeepSeekGroundedAnswerModelRoute(
        profile,
        credential,
        fetchPort as KnowledgeDeepSeekFetchPort
      );
      routeBindings.push(Object.freeze({ bundleId: profile.bundleId, route, answerRoute }));
      bundleIds.add(profile.bundleId);
      bundleCount += 1;
    }
    const routeOwner = createKnowledgeProductionModelRouteLeaseOwner(Object.freeze(routeBindings));
    return Object.freeze({
      result: Object.freeze({ kind: "ready" as const, bundleCount }),
      routeOwner,
    });
  } catch (error) {
    return createDiagnosticState(classifyPreflightFailure(error));
  }
}

/**
 * Owns one fail-closed production Knowledge preflight generation.
 *
 * Construction eagerly validates exact project profiles, credentials, and
 * private DeepSeek routes. It cannot perform network I/O because it never
 * receives or exposes a route invocation request.
 */
export class KnowledgeProductionPreflightComposer {
  /** Captures one immutable generation and performs synchronous zero-network preflight. */
  constructor(input: KnowledgeProductionPreflightComposerInput) {
    composerStates.set(this, composeGeneration(input));
    Object.freeze(this);
  }

  /** Returns the generation's frozen secret-free readiness snapshot. */
  preflight(): KnowledgeProductionPreflightResult {
    return composerStates.get(this)?.result ?? INVALID_RESULT;
  }

  /** Returns lifecycle close authority for the exact routes admitted by this preflight. */
  getModelRouteLeaseOwner(): KnowledgeProductionModelRouteLeaseOwner {
    const state = composerStates.get(this);
    if (state?.result.kind !== "ready" || !state.routeOwner) {
      throw new TypeError("The production Knowledge model route generation is unavailable");
    }
    KnowledgeProductionModelRouteLeaseOwner.assert(state.routeOwner);
    state.routeOwner.getLease().assertCurrent();
    return state.routeOwner;
  }

  /** Synchronously and permanently fails this preflight generation closed. */
  close(): void {
    const state = composerStates.get(this);
    if (!state || state === CLOSED_STATE) return;
    state.routeOwner?.close();
    composerStates.set(this, CLOSED_STATE);
  }
}

Object.freeze(KnowledgeProductionPreflightComposer.prototype);
Object.freeze(KnowledgeProductionPreflightComposer);
