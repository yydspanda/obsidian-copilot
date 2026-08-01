import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import {
  KNOWLEDGE_CITATION_CONTRACT_VERSION,
  KNOWLEDGE_PIPELINE_PROFILE_VERSION,
  createKnowledgeSourceParserProfileDigest,
  type KnowledgeBundlePipelineProfile,
  type KnowledgeSourceParserProfile,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import {
  assertKnowledgeConfigurationContainsNoSecrets,
  canonicalizeJson,
} from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";
import { SUPPORTED_OKF_VERSION } from "@/knowledge/model/types";
import { sha256 } from "@/utils/hash";

/** Current secret-free model behavior projection consumed by future Knowledge providers. */
export const KNOWLEDGE_MODEL_BEHAVIOR_CONTRACT_VERSION = 1 as const;

const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;
const DEFAULT_REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;
const VERBOSITIES = ["low", "medium", "high"] as const;
const MAX_CAPTURED_ARRAY_LENGTH = 10_000;

/** Plain project fields captured from the same Projects generation as Bundle discovery. */
export interface ProjectKnowledgePipelineProjectInput {
  id: string;
  projectModelKey: string;
  modelConfigs: unknown;
}

/** Narrow global settings projection; active model entries may retain ignored extra fields. */
export interface ProjectKnowledgePipelineSettingsInput {
  temperature: number;
  maxTokens: number;
  reasoningEffort: unknown;
  verbosity: unknown;
  activeModels: readonly unknown[];
}

/** Static compiler/parser/output behavior shared by one startup generation. */
export interface ProjectKnowledgePipelineProfileSourceOptions {
  compilerVersion: string;
  compilerConfiguration: JsonValue;
  parsers: readonly KnowledgeSourceParserProfile[];
  outputLanguage: string;
  supportedProviders: readonly string[];
}

/** Stable, non-secret failure categories for profile projection. */
export type ProjectKnowledgePipelineProfileErrorCode =
  | "input_invalid"
  | "project_missing"
  | "model_key_invalid"
  | "model_missing"
  | "model_ambiguous"
  | "model_disabled"
  | "model_not_project_enabled"
  | "provider_unsupported"
  | "model_behavior_invalid"
  | "endpoint_invalid";

/** Sanitized profile-projection failure that never retains model settings. */
export class ProjectKnowledgePipelineProfileError extends TypeError {
  /** Creates one stable profile failure. */
  constructor(public readonly code: ProjectKnowledgePipelineProfileErrorCode) {
    super("The project knowledge pipeline profile is invalid");
    this.name = "ProjectKnowledgePipelineProfileError";
  }
}

interface CapturedProject {
  id: string;
  projectModelKey: string;
  temperature?: number;
  maxTokens?: number;
}

interface CapturedActiveModel {
  name: string;
  provider: string;
  enabled: boolean;
  projectEnabled: boolean;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  numCtx?: number;
  useResponsesApi?: boolean;
  enablePromptCaching?: boolean;
  reasoningEffort?: string;
  verbosity?: string;
  endpointIdentity?: string;
  routingIdentity?: string;
}

interface CapturedSettings {
  temperature: number;
  maxTokens: number;
  reasoningEffort: string;
  verbosity: string;
  activeModels: readonly CapturedActiveModel[];
}

interface CapturedOptions {
  compilerVersion: string;
  compilerConfiguration: JsonValue;
  parsers: readonly KnowledgeSourceParserProfile[];
  outputLanguage: string;
}

interface SelectedModelBehavior {
  provider: string;
  model: string;
  configuration: JsonValue;
}

interface ProjectKnowledgePipelineProfileSourceState {
  projectsById: ReadonlyMap<string, CapturedProject>;
  settings: CapturedSettings;
  supportedProviders: ReadonlySet<string>;
  options: CapturedOptions;
}

const profileSourceStates = new WeakMap<object, ProjectKnowledgePipelineProfileSourceState>();

/** Compares strings by code unit without locale-dependent ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Reads one enumerable own data property without invoking accessors. */
function readDataProperty(value: unknown, key: string): unknown {
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
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
}

/** Reads one optional own data property while still rejecting accessors. */
function readOptionalDataProperty(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Expected own data property");
    }
    return descriptor.value;
  } catch {
    throw new ProjectKnowledgePipelineProfileError("model_behavior_invalid");
  }
}

/** Checks a non-empty identity without trimming it. */
function requireCanonicalText(
  value: unknown,
  code: ProjectKnowledgePipelineProfileErrorCode
): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new ProjectKnowledgePipelineProfileError(code);
  }
  return value;
}

/** Validates an optional finite number. */
function readOptionalFiniteNumber(value: object, key: string): number | undefined {
  const candidate = readOptionalDataProperty(value, key);
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new ProjectKnowledgePipelineProfileError("model_behavior_invalid");
  }
  return candidate;
}

/** Validates an optional positive safe integer. */
function readOptionalPositiveInteger(value: object, key: string): number | undefined {
  const candidate = readOptionalDataProperty(value, key);
  if (candidate === undefined) return undefined;
  if (!Number.isSafeInteger(candidate) || (candidate as number) < 1) {
    throw new ProjectKnowledgePipelineProfileError("model_behavior_invalid");
  }
  return candidate as number;
}

/** Validates an optional boolean behavior field. */
function readOptionalBoolean(value: object, key: string): boolean | undefined {
  const candidate = readOptionalDataProperty(value, key);
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "boolean") {
    throw new ProjectKnowledgePipelineProfileError("model_behavior_invalid");
  }
  return candidate;
}

/** Reads one closed-vocabulary optional text setting. */
function readOptionalEnum(
  value: object,
  key: string,
  allowed: readonly string[]
): string | undefined {
  const candidate = readOptionalDataProperty(value, key);
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string" || !allowed.includes(candidate)) {
    throw new ProjectKnowledgePipelineProfileError("model_behavior_invalid");
  }
  return candidate;
}

/** Reads a required closed-vocabulary text setting. */
function requireEnum(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ProjectKnowledgePipelineProfileError("model_behavior_invalid");
  }
  return value;
}

/** Reads a dense array using only its own data descriptors. */
function snapshotDenseArray(value: unknown): readonly unknown[] {
  try {
    if (!Array.isArray(value)) {
      throw new TypeError("Expected array");
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_CAPTURED_ARRAY_LENGTH ||
      Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
    ) {
      throw new TypeError("Expected dense array");
    }
    const result: unknown[] = [];
    for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Expected array data property");
      }
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch {
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
}

/** Creates a detached immutable JSON snapshot without invoking accessors. */
function snapshotJsonValue(
  value: unknown,
  ancestors: Set<object> = new Set<object>(),
  budget: { remaining: number } = { remaining: 100_000 }
): JsonValue {
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ProjectKnowledgePipelineProfileError("input_invalid");
    }
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result = snapshotDenseArray(value).map((item) =>
        snapshotJsonValue(item, ancestors, budget)
      );
      Object.freeze(result);
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ProjectKnowledgePipelineProfileError("input_invalid");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw new ProjectKnowledgePipelineProfileError("input_invalid");
    }
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of (keys as string[]).sort(compareText)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new ProjectKnowledgePipelineProfileError("input_invalid");
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

/** Canonicalizes a custom endpoint into a non-reversible identity. */
function createEndpointIdentity(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.trim() !== value) {
    throw new ProjectKnowledgePipelineProfileError("endpoint_invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProjectKnowledgePipelineProfileError("endpoint_invalid");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new ProjectKnowledgePipelineProfileError("endpoint_invalid");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return sha256(
    `knowledge-model-endpoint-v1\n${canonicalizeJson({
      protocol: parsed.protocol,
      host: parsed.host,
      pathname,
    })}`
  );
}

/** Hashes provider routing fields so profile identity retains no tenant or deployment text. */
function createRoutingIdentity(model: object): string | undefined {
  const keys = [
    "azureOpenAIApiInstanceName",
    "azureOpenAIApiDeploymentName",
    "azureOpenAIApiVersion",
    "bedrockRegion",
  ] as const;
  const routing: Record<string, JsonValue> = {};
  for (const key of keys) {
    const candidate = readOptionalDataProperty(model, key);
    if (candidate === undefined || candidate === "") continue;
    routing[key] = requireCanonicalText(candidate, "model_behavior_invalid");
  }
  if (Object.keys(routing).length === 0) return undefined;
  return sha256(`knowledge-model-routing-v1\n${canonicalizeJson(routing)}`);
}

/** Captures a project record without retaining unrelated project text or Bundle input. */
function captureProject(value: unknown): CapturedProject {
  try {
    const id = requireCanonicalText(readDataProperty(value, "id"), "input_invalid");
    const projectModelKey = requireCanonicalText(
      readDataProperty(value, "projectModelKey"),
      "model_key_invalid"
    );
    const configs = readDataProperty(value, "modelConfigs");
    if (typeof configs !== "object" || configs === null || Array.isArray(configs)) {
      throw new ProjectKnowledgePipelineProfileError("input_invalid");
    }
    const allowedKeys = new Set(["temperature", "maxTokens"]);
    const configKeys = Reflect.ownKeys(configs);
    const prototype = Object.getPrototypeOf(configs);
    if (
      configKeys.some((key) => typeof key !== "string" || !allowedKeys.has(key)) ||
      (prototype !== Object.prototype && prototype !== null)
    ) {
      throw new ProjectKnowledgePipelineProfileError("input_invalid");
    }
    const temperature = readOptionalFiniteNumber(configs, "temperature");
    const maxTokens = readOptionalPositiveInteger(configs, "maxTokens");
    return Object.freeze({
      id,
      projectModelKey,
      ...(temperature === undefined ? {} : { temperature }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    });
  } catch (error) {
    if (error instanceof ProjectKnowledgePipelineProfileError) throw error;
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
}

/** Captures identity for every model and behavior only for project-selected identities. */
function captureActiveModel(
  value: unknown,
  selectedModelKeys: ReadonlySet<string>
): CapturedActiveModel {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
  const name = requireCanonicalText(readDataProperty(value, "name"), "model_behavior_invalid");
  const provider = requireCanonicalText(
    readDataProperty(value, "provider"),
    "model_behavior_invalid"
  );
  if (!selectedModelKeys.has(`${name}|${provider}`)) {
    return Object.freeze({ name, provider, enabled: false, projectEnabled: false });
  }
  const enabled = readOptionalDataProperty(value, "enabled");
  const projectEnabled = readOptionalDataProperty(value, "projectEnabled");
  if (
    (enabled !== undefined && typeof enabled !== "boolean") ||
    (projectEnabled !== undefined && typeof projectEnabled !== "boolean")
  ) {
    throw new ProjectKnowledgePipelineProfileError("model_behavior_invalid");
  }
  const temperature = readOptionalFiniteNumber(value, "temperature");
  const maxTokens = readOptionalPositiveInteger(value, "maxTokens");
  const topP = readOptionalFiniteNumber(value, "topP");
  const frequencyPenalty = readOptionalFiniteNumber(value, "frequencyPenalty");
  const numCtx = readOptionalPositiveInteger(value, "numCtx");
  const useResponsesApi = readOptionalBoolean(value, "useResponsesApi");
  const enablePromptCaching = readOptionalBoolean(value, "enablePromptCaching");
  const reasoningEffort = readOptionalEnum(value, "reasoningEffort", REASONING_EFFORTS);
  const verbosity = readOptionalEnum(value, "verbosity", VERBOSITIES);
  const endpointIdentity = createEndpointIdentity(readOptionalDataProperty(value, "baseUrl"));
  const routingIdentity = createRoutingIdentity(value);
  return Object.freeze({
    name,
    provider,
    enabled: enabled === true,
    projectEnabled: projectEnabled === true,
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(topP === undefined ? {} : { topP }),
    ...(frequencyPenalty === undefined ? {} : { frequencyPenalty }),
    ...(numCtx === undefined ? {} : { numCtx }),
    ...(useResponsesApi === undefined ? {} : { useResponsesApi }),
    ...(enablePromptCaching === undefined ? {} : { enablePromptCaching }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(verbosity === undefined ? {} : { verbosity }),
    ...(endpointIdentity === undefined ? {} : { endpointIdentity }),
    ...(routingIdentity === undefined ? {} : { routingIdentity }),
  });
}

/** Captures the settings allowlist once so later resolutions cannot observe mutation. */
function captureSettings(
  value: ProjectKnowledgePipelineSettingsInput,
  selectedModelKeys: ReadonlySet<string>
): CapturedSettings {
  const temperature = readDataProperty(value, "temperature");
  const maxTokens = readDataProperty(value, "maxTokens");
  if (
    typeof temperature !== "number" ||
    !Number.isFinite(temperature) ||
    !Number.isSafeInteger(maxTokens) ||
    (maxTokens as number) < 1
  ) {
    throw new ProjectKnowledgePipelineProfileError("model_behavior_invalid");
  }
  const reasoningEffort = requireEnum(
    readDataProperty(value, "reasoningEffort"),
    DEFAULT_REASONING_EFFORTS
  );
  const verbosity = requireEnum(readDataProperty(value, "verbosity"), VERBOSITIES);
  const activeModels = snapshotDenseArray(readDataProperty(value, "activeModels")).map((model) =>
    captureActiveModel(model, selectedModelKeys)
  );
  return Object.freeze({
    temperature,
    maxTokens: maxTokens as number,
    reasoningEffort,
    verbosity,
    activeModels: Object.freeze(activeModels),
  });
}

/** Captures static compiler/parser behavior as detached immutable JSON. */
function captureOptions(value: ProjectKnowledgePipelineProfileSourceOptions): {
  options: CapturedOptions;
  supportedProviders: ReadonlySet<string>;
} {
  const compilerVersion = requireCanonicalText(
    readDataProperty(value, "compilerVersion"),
    "input_invalid"
  );
  const outputLanguage = requireCanonicalText(
    readDataProperty(value, "outputLanguage"),
    "input_invalid"
  );
  let compilerConfiguration: JsonValue;
  let parserSnapshot: JsonValue;
  try {
    compilerConfiguration = snapshotJsonValue(readDataProperty(value, "compilerConfiguration"));
    parserSnapshot = snapshotJsonValue(readDataProperty(value, "parsers"));
  } catch {
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
  if (!Array.isArray(parserSnapshot) || parserSnapshot.length === 0) {
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
  const parsers = parserSnapshot as unknown as readonly KnowledgeSourceParserProfile[];
  try {
    assertKnowledgeConfigurationContainsNoSecrets(compilerConfiguration);
    for (const parser of parsers) {
      createKnowledgeSourceParserProfileDigest(parser);
      assertKnowledgeConfigurationContainsNoSecrets(parser.configuration);
    }
  } catch {
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
  const providers = snapshotDenseArray(readDataProperty(value, "supportedProviders")).map(
    (provider) => requireCanonicalText(provider, "input_invalid")
  );
  if (providers.length === 0 || new Set(providers).size !== providers.length) {
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
  return {
    options: Object.freeze({
      compilerVersion,
      compilerConfiguration,
      parsers: Object.freeze([...parsers]),
      outputLanguage,
    }),
    supportedProviders: new Set(providers),
  };
}

/** Resolves one exact enabled project model into a secret-free behavior projection. */
function selectModelBehavior(
  project: CapturedProject,
  settings: CapturedSettings,
  supportedProviders: ReadonlySet<string>
): SelectedModelBehavior {
  const matches = settings.activeModels.filter(
    (candidate) => `${candidate.name}|${candidate.provider}` === project.projectModelKey
  );
  if (matches.length === 0) {
    throw new ProjectKnowledgePipelineProfileError("model_missing");
  }
  if (matches.length !== 1) {
    throw new ProjectKnowledgePipelineProfileError("model_ambiguous");
  }
  const selected = matches[0];
  if (!selected.enabled) {
    throw new ProjectKnowledgePipelineProfileError("model_disabled");
  }
  if (!selected.projectEnabled) {
    throw new ProjectKnowledgePipelineProfileError("model_not_project_enabled");
  }
  if (!supportedProviders.has(selected.provider)) {
    throw new ProjectKnowledgePipelineProfileError("provider_unsupported");
  }
  const configuration: JsonValue = Object.freeze({
    behaviorContractVersion: KNOWLEDGE_MODEL_BEHAVIOR_CONTRACT_VERSION,
    adapterPolicy: "knowledge-projection-only-v1",
    routingPolicy: "private-bound-capability-v1",
    structuredOutput: "json-schema-v1",
    streaming: false,
    modelFallback: false,
    temperature: project.temperature ?? selected.temperature ?? settings.temperature,
    maxTokens: project.maxTokens ?? selected.maxTokens ?? settings.maxTokens,
    reasoningEffort: selected.reasoningEffort ?? settings.reasoningEffort,
    verbosity: selected.verbosity ?? settings.verbosity,
    ...(selected.topP === undefined ? {} : { topP: selected.topP }),
    ...(selected.frequencyPenalty === undefined
      ? {}
      : { frequencyPenalty: selected.frequencyPenalty }),
    ...(selected.numCtx === undefined ? {} : { numCtx: selected.numCtx }),
    ...(selected.useResponsesApi === undefined
      ? {}
      : { useResponsesApi: selected.useResponsesApi }),
    ...(selected.enablePromptCaching === undefined
      ? {}
      : { enablePromptCaching: selected.enablePromptCaching }),
    ...(selected.endpointIdentity === undefined
      ? {}
      : { endpointIdentity: selected.endpointIdentity }),
    ...(selected.routingIdentity === undefined
      ? {}
      : { routingIdentity: selected.routingIdentity }),
  });
  return Object.freeze({ provider: selected.provider, model: selected.name, configuration });
}

/** Returns opaque source state only for an authentic constructed instance. */
function requireProfileSourceState(value: unknown): ProjectKnowledgePipelineProfileSourceState {
  if (typeof value !== "object" || value === null) {
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
  const state = profileSourceStates.get(value);
  if (!state) {
    throw new ProjectKnowledgePipelineProfileError("input_invalid");
  }
  return state;
}

/**
 * Projects one Projects/settings generation into strict, secret-free pipeline profiles.
 *
 * Full model records may contain API keys, but this source reads only a fixed
 * positive allowlist of behavior fields. A future provider adapter must consume
 * this projection rather than spreading the original model object again.
 */
export class ProjectKnowledgePipelineProfileSource {
  /** Captures one immutable project/settings generation and static pipeline behavior. */
  constructor(
    projects: readonly ProjectKnowledgePipelineProjectInput[],
    settings: ProjectKnowledgePipelineSettingsInput,
    options: ProjectKnowledgePipelineProfileSourceOptions
  ) {
    const capturedProjects = snapshotDenseArray(projects).map(captureProject);
    const projectsById = new Map<string, CapturedProject>();
    for (const project of capturedProjects) {
      if (projectsById.has(project.id)) {
        throw new ProjectKnowledgePipelineProfileError("input_invalid");
      }
      projectsById.set(project.id, project);
    }
    const capturedOptions = captureOptions(options);
    const selectedModelKeys = new Set(
      capturedProjects.map(({ projectModelKey }) => projectModelKey)
    );
    profileSourceStates.set(
      this,
      Object.freeze({
        projectsById,
        settings: captureSettings(settings, selectedModelKeys),
        supportedProviders: capturedOptions.supportedProviders,
        options: capturedOptions.options,
      })
    );
    Object.freeze(this);
  }

  /** Resolves the exact Bundle owner's configured project model without fallback. */
  resolve(owner: ConfiguredProjectKnowledgeBundle): KnowledgeBundlePipelineProfile {
    const state = requireProfileSourceState(this);
    const projectId = requireCanonicalText(readDataProperty(owner, "projectId"), "input_invalid");
    const config = readDataProperty(owner, "config");
    const bundleId = requireCanonicalText(readDataProperty(config, "id"), "input_invalid");
    const project = state.projectsById.get(projectId);
    if (!project) {
      throw new ProjectKnowledgePipelineProfileError("project_missing");
    }
    const model = selectModelBehavior(project, state.settings, state.supportedProviders);
    return Object.freeze({
      version: KNOWLEDGE_PIPELINE_PROFILE_VERSION,
      bundleId,
      compiler: Object.freeze({
        version: state.options.compilerVersion,
        configuration: state.options.compilerConfiguration,
      }),
      parsers: state.options.parsers,
      model,
      outputLanguage: state.options.outputLanguage,
      okfVersion: SUPPORTED_OKF_VERSION,
      citationContractVersion: KNOWLEDGE_CITATION_CONTRACT_VERSION,
    });
  }
}

Object.freeze(ProjectKnowledgePipelineProfileSource.prototype);
Object.freeze(ProjectKnowledgePipelineProfileSource);
