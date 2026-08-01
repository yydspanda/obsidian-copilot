import type { CustomModel, ProjectConfig } from "@/aiParams";
import { ChatModelProviders, ReasoningEffort } from "@/constants";

/** Provider-specific parameter visibility and allowed reasoning choices. */
export interface ModelParameterUiPolicy {
  isDirectDeepSeek: boolean;
  thinkingEnabled: boolean;
  showTemperature: boolean;
  showTopP: boolean;
  showFrequencyPenalty: boolean;
  reasoningEffortOptions?: ReadonlyArray<{ value: ReasoningEffort; label: string }>;
}

/** Atomic model updates needed when the reasoning mode changes. */
export interface ReasoningEffortModelUpdate {
  updates: Partial<CustomModel>;
  resetFields: ReadonlyArray<keyof CustomModel>;
}

/** Exact reasoning choices reviewed for the direct DeepSeek provider. */
export const DEEPSEEK_REASONING_EFFORT_OPTIONS = Object.freeze([
  { value: ReasoningEffort.MINIMAL, label: "Minimal" },
  { value: ReasoningEffort.HIGH, label: "High" },
  { value: ReasoningEffort.XHIGH, label: "Extra High" },
] as const);

/** Returns whether one catalog record uses the direct DeepSeek provider. */
export function isDirectDeepSeekModel(model: Pick<CustomModel, "provider">): boolean {
  return model.provider === String(ChatModelProviders.DEEPSEEK);
}

/** Returns whether one direct DeepSeek record explicitly enables thinking. */
export function isDirectDeepSeekThinkingModel(
  model: Pick<CustomModel, "provider" | "reasoningEffort">
): boolean {
  return (
    isDirectDeepSeekModel(model) &&
    model.reasoningEffort !== undefined &&
    model.reasoningEffort !== ReasoningEffort.MINIMAL
  );
}

/** Resolves provider-aware controls without embedding UI state in the transport policy. */
export function getModelParameterUiPolicy(
  model: Pick<CustomModel, "provider" | "reasoningEffort">
): ModelParameterUiPolicy {
  const isDeepSeek = isDirectDeepSeekModel(model);
  const thinkingEnabled = isDirectDeepSeekThinkingModel(model);
  return Object.freeze({
    isDirectDeepSeek: isDeepSeek,
    thinkingEnabled,
    showTemperature: !thinkingEnabled,
    showTopP: !thinkingEnabled,
    showFrequencyPenalty: !isDeepSeek,
    ...(isDeepSeek ? { reasoningEffortOptions: DEEPSEEK_REASONING_EFFORT_OPTIONS } : {}),
  });
}

/** Creates one atomic, wire-valid update for a reasoning-effort selection. */
export function createReasoningEffortModelUpdate(
  model: Pick<CustomModel, "provider">,
  reasoningEffort: ReasoningEffort
): ReasoningEffortModelUpdate {
  if (!isDirectDeepSeekModel(model)) {
    return Object.freeze({
      updates: Object.freeze({ reasoningEffort }),
      resetFields: Object.freeze([]),
    });
  }
  if (reasoningEffort === ReasoningEffort.MINIMAL) {
    return Object.freeze({
      updates: Object.freeze({ reasoningEffort }),
      resetFields: Object.freeze(["frequencyPenalty"] as const),
    });
  }
  return Object.freeze({
    updates: Object.freeze({ reasoningEffort, temperature: 0 }),
    resetFields: Object.freeze(["topP", "frequencyPenalty"] as const),
  });
}

/** Normalizes project overrides when a newly selected model requires thinking-safe sampling. */
export function normalizeProjectModelConfigsForSelection(
  modelConfigs: ProjectConfig["modelConfigs"],
  selectedModel: Pick<CustomModel, "provider" | "reasoningEffort">
): ProjectConfig["modelConfigs"] {
  if (!isDirectDeepSeekThinkingModel(selectedModel)) {
    return { ...modelConfigs };
  }
  return { ...modelConfigs, temperature: 0 };
}

/** Resolves the project temperature slider value and lock state for one selected model. */
export function getProjectTemperatureControl(
  selectedModel: Pick<CustomModel, "provider" | "reasoningEffort"> | undefined,
  configuredTemperature: number | undefined,
  defaultTemperature: number
): Readonly<{ value: number; disabled: boolean }> {
  if (selectedModel && isDirectDeepSeekThinkingModel(selectedModel)) {
    return Object.freeze({ value: 0, disabled: true });
  }
  return Object.freeze({
    value: configuredTemperature ?? defaultTemperature,
    disabled: false,
  });
}
