import { resolveDeepSeekWireModelIdentity } from "@/LLMProviders/deepseekModelPolicy";
import {
  KnowledgeProductionPreflightComposer,
  type KnowledgeProductionPreflightDiagnosticCode,
  type KnowledgeProductionPreflightSettingsInput,
} from "@/knowledge/compiler/KnowledgeProductionPreflightComposer";
import type { KnowledgeDeepSeekFetchPort } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import {
  ProjectKnowledgePipelineProfileError,
  ProjectKnowledgePipelineProfileSource,
  type ProjectKnowledgePipelineProfileErrorCode,
  type ProjectKnowledgePipelineProfileSourceOptions,
  type ProjectKnowledgePipelineProjectInput,
  type ProjectKnowledgePipelineSettingsInput,
} from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import type {
  ConfiguredModel,
  EnabledBackendEntry,
  ModelManagementApi,
  Provider,
  ResolvedChatBackendEntry,
} from "@/modelManagement";
import {
  findChatBackendEntryMatches,
  hasAmbiguousPersistedChatModelSelection,
} from "@/modelManagement";

/** Knowledge-owned defaults retained after ordinary Chat retired its global output cap. */
export const KNOWLEDGE_CONFIGURED_MODEL_DEFAULTS = Object.freeze({
  // Knowledge fingerprints require one explicit output budget even though ordinary
  // Chat no longer persists a global maxTokens cap.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/312
  maxTokens: 6_000,
  temperature: 0.1,
  verbosity: "medium" as const,
});

/** One Project model selection captured for a configured Knowledge generation. */
export interface KnowledgeConfiguredModelProjectInput {
  id: string;
  /** Configured-model id for V4 writes; legacy `model|provider` values remain readable. */
  modelSelection: string;
  modelConfigs: unknown;
}

/** Secret-free registry snapshots consumed by the pure projection boundary. */
export interface KnowledgeConfiguredModelProjectionInput {
  owners: readonly ConfiguredProjectKnowledgeBundle[];
  projects: readonly KnowledgeConfiguredModelProjectInput[];
  enabledChatModels: readonly EnabledBackendEntry[];
  configuredModels: readonly ConfiguredModel[];
  providers: readonly Provider[];
  profileOptions: ProjectKnowledgePipelineProfileSourceOptions;
}

/** Credential lookup retained separately from the behavior-only active-model projection. */
export interface KnowledgeConfiguredModelCredentialBinding {
  activeModelIndex: number;
  providerId: string;
}

/** Ephemeral compatibility shape accepted by the existing Knowledge profile source. */
export interface KnowledgeConfiguredModelProjection {
  owners: readonly ConfiguredProjectKnowledgeBundle[];
  projects: readonly ProjectKnowledgePipelineProjectInput[];
  settings: ProjectKnowledgePipelineSettingsInput;
  profileSource: ProjectKnowledgePipelineProfileSource;
  credentialBindings: readonly KnowledgeConfiguredModelCredentialBinding[];
}

/** Stable, value-free failures emitted before a private route can be constructed. */
export type KnowledgeConfiguredModelBridgeDiagnosticCode =
  | "input_invalid"
  | "project_missing"
  | "model_missing"
  | "model_ambiguous"
  | "provider_unsupported"
  | "model_unsupported"
  | `profile_${ProjectKnowledgePipelineProfileErrorCode}`
  | KnowledgeProductionPreflightDiagnosticCode;

/** Pure configured-model projection result. */
export type KnowledgeConfiguredModelProjectionResult =
  | Readonly<{ kind: "ready"; projection: KnowledgeConfiguredModelProjection }>
  | Readonly<{ kind: "diagnostic"; code: KnowledgeConfiguredModelBridgeDiagnosticCode }>;

/** Inputs required to hydrate credentials and construct a zero-network preflight. */
export interface PrepareKnowledgeConfiguredModelPreflightInput {
  owners: readonly ConfiguredProjectKnowledgeBundle[];
  projects: readonly KnowledgeConfiguredModelProjectInput[];
  modelManagement: Pick<
    ModelManagementApi,
    "backendConfigRegistry" | "configuredModelRegistry" | "providerRegistry"
  >;
  profileOptions: ProjectKnowledgePipelineProfileSourceOptions;
  fetchPort: KnowledgeDeepSeekFetchPort;
  signal: AbortSignal;
}

/** Prepared private-route generation or one credential-free diagnostic. */
export type PreparedKnowledgeConfiguredModelPreflight =
  | Readonly<{
      kind: "ready";
      profileSource: ProjectKnowledgePipelineProfileSource;
      preflight: KnowledgeProductionPreflightComposer;
    }>
  | Readonly<{ kind: "diagnostic"; code: KnowledgeConfiguredModelBridgeDiagnosticCode }>;

interface ProjectedActiveModel {
  providerId: string;
  modelKey: string;
  value: Readonly<Record<string, unknown>>;
}

/** Internal sanitized projection failure. */
class KnowledgeConfiguredModelProjectionFailure extends TypeError {
  constructor(public readonly code: KnowledgeConfiguredModelBridgeDiagnosticCode) {
    super("The configured Knowledge model projection is unavailable");
    this.name = "KnowledgeConfiguredModelProjectionFailure";
  }
}

function createDiagnostic(
  code: KnowledgeConfiguredModelBridgeDiagnosticCode
): Readonly<{ kind: "diagnostic"; code: KnowledgeConfiguredModelBridgeDiagnosticCode }> {
  return Object.freeze({ kind: "diagnostic" as const, code });
}

function fail(code: KnowledgeConfiguredModelBridgeDiagnosticCode): never {
  throw new KnowledgeConfiguredModelProjectionFailure(code);
}

function requireCanonicalText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    fail("input_invalid");
  }
  return value;
}

function isRuntimeArray(value: unknown): boolean {
  return Array.isArray(value);
}

function requireResolvedEntry(
  entries: readonly EnabledBackendEntry[],
  selection: string,
  configuredModels: readonly ConfiguredModel[],
  providers: readonly Provider[]
): ResolvedChatBackendEntry {
  // Disabled rows still identify the account that originally owned a legacy
  // Project key. Never let an enabled row on another account inherit it.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  if (hasAmbiguousPersistedChatModelSelection({ configuredModels, providers }, selection)) {
    fail("model_ambiguous");
  }
  const matches = findChatBackendEntryMatches(entries, selection);
  // Project model retirement left old selections readable, but neither a stale
  // configured id nor an ambiguous legacy key may inherit the first enabled row.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/310
  if (matches.length === 0) fail("model_missing");
  if (matches.length !== 1) fail("model_ambiguous");
  return matches[0];
}

function projectActiveModel(entry: ResolvedChatBackendEntry): ProjectedActiveModel {
  const { configuredModel, provider } = entry;
  if (
    entry.configuredModelId !== configuredModel.configuredModelId ||
    configuredModel.providerId !== provider.providerId
  ) {
    fail("input_invalid");
  }
  if (
    provider.providerType !== "openai-compatible" ||
    provider.origin.kind !== "byok" ||
    provider.origin.catalogProviderId !== "deepseek" ||
    provider.requiresApiKey === false
  ) {
    fail("provider_unsupported");
  }

  const configuredModelIdentity = requireCanonicalText(configuredModel.info.id);
  // Resolve the temporary persisted Flash alias only after the configured row
  // has been selected exactly. This keeps UUID/project references stable while
  // making equivalent old and new settings produce one canonical profile.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  const model = resolveDeepSeekWireModelIdentity(configuredModelIdentity);
  if (model === undefined || configuredModel.info.isEmbedding === true) {
    fail("model_unsupported");
  }
  const behavior = {
    temperature: KNOWLEDGE_CONFIGURED_MODEL_DEFAULTS.temperature,
    reasoningEffort: "minimal" as const,
  };
  const modelKey = `${model}|deepseek`;
  return Object.freeze({
    providerId: provider.providerId,
    modelKey,
    value: Object.freeze({
      name: model,
      provider: "deepseek",
      enabled: true,
      projectEnabled: true,
      temperature: behavior.temperature,
      maxTokens: KNOWLEDGE_CONFIGURED_MODEL_DEFAULTS.maxTokens,
      reasoningEffort: behavior.reasoningEffort,
      verbosity: KNOWLEDGE_CONFIGURED_MODEL_DEFAULTS.verbosity,
      ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    }),
  });
}

function classifyProjectionFailure(error: unknown): KnowledgeConfiguredModelBridgeDiagnosticCode {
  if (error instanceof KnowledgeConfiguredModelProjectionFailure) return error.code;
  const profileCode = ProjectKnowledgePipelineProfileError.inspect(error);
  return profileCode === undefined ? "input_invalid" : `profile_${profileCode}`;
}

/**
 * Resolves exact Project selections against V4 enabled Provider/ConfiguredModel rows.
 *
 * The returned profile source and settings projection contain behavior only. They
 * are ephemeral compatibility inputs for existing Knowledge Core and must never be
 * persisted back into upstream settings.
 *
 * @param input - Bundle owners, Project selections, enabled chat registry rows, and profile policy
 * @returns A frozen secret-free projection or one stable diagnostic
 */
export function createKnowledgeConfiguredModelProjection(
  input: KnowledgeConfiguredModelProjectionInput
): KnowledgeConfiguredModelProjectionResult {
  try {
    // The complete retained inventory is a security input: without it a
    // disabled Project model can be mistaken for an unrelated enabled owner.
    // https://github.com/yydspanda/obsidian-copilot/issues/3
    if (
      !isRuntimeArray(input.owners) ||
      input.owners.length === 0 ||
      !isRuntimeArray(input.projects) ||
      !isRuntimeArray(input.enabledChatModels) ||
      !isRuntimeArray(input.configuredModels) ||
      !isRuntimeArray(input.providers)
    ) {
      fail("input_invalid");
    }

    const projectsById = new Map<string, KnowledgeConfiguredModelProjectInput>();
    for (const project of input.projects) {
      const projectId = requireCanonicalText(project.id);
      if (projectsById.has(projectId)) fail("input_invalid");
      projectsById.set(projectId, project);
    }

    const projectedProjects = new Map<string, ProjectKnowledgePipelineProjectInput>();
    const activeModelsByKey = new Map<string, ProjectedActiveModel>();
    for (const owner of input.owners) {
      const projectId = requireCanonicalText(owner.projectId);
      if (projectedProjects.has(projectId)) continue;
      const project = projectsById.get(projectId);
      if (!project) fail("project_missing");
      const selection = requireCanonicalText(project.modelSelection);
      const selected = projectActiveModel(
        requireResolvedEntry(
          input.enabledChatModels,
          selection,
          input.configuredModels,
          input.providers
        )
      );
      const existing = activeModelsByKey.get(selected.modelKey);
      // Equivalent old/current Flash rows may share one provider credential;
      // rows owned by different providers must remain distinct and ambiguous.
      // https://github.com/yydspanda/obsidian-copilot/issues/3
      if (existing && existing.providerId !== selected.providerId) {
        fail("model_ambiguous");
      }
      if (!existing) activeModelsByKey.set(selected.modelKey, selected);
      projectedProjects.set(
        projectId,
        Object.freeze({
          id: projectId,
          projectModelKey: selected.modelKey,
          modelConfigs: project.modelConfigs,
        })
      );
    }

    const selectedModels = [...activeModelsByKey.values()];
    const projects = Object.freeze([...projectedProjects.values()]);
    const settings: ProjectKnowledgePipelineSettingsInput = Object.freeze({
      temperature: KNOWLEDGE_CONFIGURED_MODEL_DEFAULTS.temperature,
      maxTokens: KNOWLEDGE_CONFIGURED_MODEL_DEFAULTS.maxTokens,
      reasoningEffort: "minimal",
      verbosity: KNOWLEDGE_CONFIGURED_MODEL_DEFAULTS.verbosity,
      activeModels: Object.freeze(selectedModels.map(({ value }) => value)),
    });
    const profileSource = new ProjectKnowledgePipelineProfileSource(
      projects,
      settings,
      input.profileOptions
    );
    const owners = Object.freeze([...input.owners]);
    for (const owner of owners) profileSource.resolve(owner);

    return Object.freeze({
      kind: "ready" as const,
      projection: Object.freeze({
        owners,
        projects,
        settings,
        profileSource,
        credentialBindings: Object.freeze(
          selectedModels.map(({ providerId }, activeModelIndex) =>
            Object.freeze({ activeModelIndex, providerId })
          )
        ),
      }),
    });
  } catch (error) {
    return createDiagnostic(classifyProjectionFailure(error));
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

/**
 * Hydrates selected DeepSeek credentials through V4 model management and hands
 * them directly to the existing private-route preflight constructor.
 *
 * The returned profile source is the secret-free instance created before any
 * keychain read. Plaintext credentials are not returned or retained outside the
 * private routes owned by the returned preflight.
 *
 * @param input - Current generation snapshots, model-management API, fetch capability, and cancellation
 * @returns A ready profile/preflight pair or one credential-free diagnostic
 */
export async function prepareKnowledgeConfiguredModelPreflight(
  input: PrepareKnowledgeConfiguredModelPreflightInput
): Promise<PreparedKnowledgeConfiguredModelPreflight> {
  throwIfAborted(input.signal);
  let enabledChatModels: readonly EnabledBackendEntry[];
  try {
    enabledChatModels = input.modelManagement.backendConfigRegistry.resolveEnabled("chat");
  } catch {
    return createDiagnostic("input_invalid");
  }
  const projected = createKnowledgeConfiguredModelProjection({
    owners: input.owners,
    projects: input.projects,
    enabledChatModels,
    configuredModels: input.modelManagement.configuredModelRegistry.list(),
    providers: input.modelManagement.providerRegistry.list(),
    profileOptions: input.profileOptions,
  });
  if (projected.kind === "diagnostic") return projected;

  const { projection } = projected;
  const credentials = new Map<string, string | null>();
  try {
    for (const { providerId } of projection.credentialBindings) {
      if (credentials.has(providerId)) continue;
      const credential = await input.modelManagement.providerRegistry.getApiKey(providerId);
      throwIfAborted(input.signal);
      credentials.set(providerId, credential);
    }
  } catch {
    throwIfAborted(input.signal);
    return createDiagnostic("route_credential_invalid");
  }
  throwIfAborted(input.signal);

  let activeModels: readonly Readonly<Record<string, unknown>>[];
  try {
    activeModels = Object.freeze(
      projection.settings.activeModels.map((model, activeModelIndex) => {
        const binding = projection.credentialBindings[activeModelIndex];
        if (!binding || typeof model !== "object" || model === null || Array.isArray(model)) {
          fail("input_invalid");
        }
        return Object.freeze({
          ...(model as Record<string, unknown>),
          apiKey: credentials.get(binding.providerId) ?? "",
        });
      })
    );
  } catch (error) {
    return createDiagnostic(classifyProjectionFailure(error));
  }
  const settings: KnowledgeProductionPreflightSettingsInput = Object.freeze({
    ...projection.settings,
    activeModels,
    deepseekApiKey: "",
  });

  let preflight: KnowledgeProductionPreflightComposer;
  try {
    preflight = new KnowledgeProductionPreflightComposer({
      owners: projection.owners,
      projects: projection.projects,
      settings,
      profileOptions: input.profileOptions,
      profileSource: projection.profileSource,
      fetchPort: input.fetchPort,
    });
  } catch {
    return createDiagnostic("input_invalid");
  }
  const result = preflight.preflight();
  if (result.kind === "diagnostic") {
    preflight.close();
    return createDiagnostic(result.code);
  }
  return Object.freeze({
    kind: "ready" as const,
    profileSource: projection.profileSource,
    preflight,
  });
}
