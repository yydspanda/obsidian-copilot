export type KnowledgeChatModelReadinessReason =
  | "missing"
  | "ambiguous"
  | "disabled"
  | "unsupported"
  | "not_project_enabled"
  | "credential_missing"
  | "configured";

export interface KnowledgeChatModelReadinessCandidateInput {
  readonly modelKey: string;

  readonly enabled: boolean;

  readonly supported: boolean;

  readonly projectEnabled: boolean;

  readonly credentialConfigured: boolean;
}

export type KnowledgeChatModelReadinessSelectionInput =
  | Readonly<{
      mode: "default";
      selectedModelKey: string | null | undefined;
    }>
  | Readonly<{
      mode: "project";
      projectModelKey: string | null | undefined;
    }>;

export interface KnowledgeChatModelReadinessInput {
  readonly selection: KnowledgeChatModelReadinessSelectionInput;
  readonly activeModels: readonly KnowledgeChatModelReadinessCandidateInput[];
}

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
