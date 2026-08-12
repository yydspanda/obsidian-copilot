/** Closed local-readiness outcomes rendered by the Knowledge setup surface. */
export type KnowledgeChatModelReadinessReason =
  | "missing"
  | "ambiguous"
  | "disabled"
  | "unsupported"
  | "not_project_enabled"
  | "credential_missing"
  | "configured";

/** Secret-free metadata for one saved Chat model reference. */
export interface KnowledgeChatModelReadinessCandidateInput {
  /** Exact persisted identity, using the same `name|provider` form as Chat settings. */
  readonly modelKey: string;
  /** Whether the saved model is enabled for ordinary Chat use. */
  readonly enabled: boolean;
  /** Whether the saved reference passed the caller's runnable-model policy. */
  readonly supported: boolean;
  /** Whether the saved model is explicitly allowed in Project mode. */
  readonly projectEnabled: boolean;
  /** Whether the required credential is present in local configuration. */
  readonly credentialConfigured: boolean;
}

/** Exact selection authority used for this local readiness observation. */
export type KnowledgeChatModelReadinessSelectionInput =
  | Readonly<{
      mode: "default";
      selectedModelKey: string | null | undefined;
    }>
  | Readonly<{
      mode: "project";
      projectModelKey: string | null | undefined;
    }>;

/** Plain, least-data input for projecting Chat model readiness without settings access. */
export interface KnowledgeChatModelReadinessInput {
  readonly selection: KnowledgeChatModelReadinessSelectionInput;
  readonly activeModels: readonly KnowledgeChatModelReadinessCandidateInput[];
}

/** Frozen, secret-free readiness observation safe to retain in UI state. */
export interface KnowledgeChatModelReadiness {
  readonly reason: KnowledgeChatModelReadinessReason;
}

const READINESS_BY_REASON: Readonly<
  Record<KnowledgeChatModelReadinessReason, KnowledgeChatModelReadiness>
> = Object.freeze({
  missing: Object.freeze({ reason: "missing" }),
  ambiguous: Object.freeze({ reason: "ambiguous" }),
  disabled: Object.freeze({ reason: "disabled" }),
  unsupported: Object.freeze({ reason: "unsupported" }),
  not_project_enabled: Object.freeze({ reason: "not_project_enabled" }),
  credential_missing: Object.freeze({ reason: "credential_missing" }),
  configured: Object.freeze({ reason: "configured" }),
});

/**
 * Projects one local Chat model selection into a closed readiness reason.
 *
 * This projector performs no fallback, settings reads, credential reads, model
 * construction, or network work. Project mode uses only its exact Project
 * selection, so a model that is absent or not Project-enabled cannot inherit a
 * green result from the default Chat selection.
 *
 * @param input - Exact selection plus caller-sanitized, secret-free model metadata
 * @returns One frozen singleton that never retains any supplied model identity
 */
export function projectKnowledgeChatModelReadiness(
  input: KnowledgeChatModelReadinessInput
): KnowledgeChatModelReadiness {
  const selection = input.selection;
  const selectedModelKey =
    selection.mode === "project" ? selection.projectModelKey : selection.selectedModelKey;
  if (typeof selectedModelKey !== "string" || selectedModelKey.length === 0) {
    return READINESS_BY_REASON.missing;
  }

  const matchingModels = input.activeModels.filter(
    (candidate) => candidate.modelKey === selectedModelKey
  );
  if (matchingModels.length === 0) return READINESS_BY_REASON.missing;
  if (matchingModels.length !== 1) return READINESS_BY_REASON.ambiguous;

  const selectedModel = matchingModels[0];
  if (!selectedModel.enabled) return READINESS_BY_REASON.disabled;
  if (selection.mode === "project" && !selectedModel.projectEnabled) {
    return READINESS_BY_REASON.not_project_enabled;
  }
  if (!selectedModel.supported) return READINESS_BY_REASON.unsupported;
  if (!selectedModel.credentialConfigured) return READINESS_BY_REASON.credential_missing;
  return READINESS_BY_REASON.configured;
}
