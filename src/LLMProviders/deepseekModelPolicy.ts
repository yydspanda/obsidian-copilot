/** Official DeepSeek model identities accepted by the direct provider integration. */
export const CURRENT_DEEPSEEK_MODEL_IDENTITIES = Object.freeze([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
] as const);

const CURRENT_DEEPSEEK_MODELS = new Set<string>(CURRENT_DEEPSEEK_MODEL_IDENTITIES);

/** Stable configuration failures raised before a direct DeepSeek request is created. */
export type DeepSeekModelPolicyErrorCode =
  | "model_unsupported"
  | "reasoning_effort_unsupported"
  | "sampling_unsupported"
  | "frequency_penalty_unsupported";

/** Sanitized DeepSeek policy failure that retains no model configuration. */
export class DeepSeekModelPolicyError extends TypeError {
  /** Creates one stable configuration failure. */
  constructor(public readonly code: DeepSeekModelPolicyErrorCode) {
    super("The DeepSeek model configuration is not supported");
    this.name = "DeepSeekModelPolicyError";
  }
}

/** Narrow behavior projection accepted from one direct DeepSeek model record. */
export interface DeepSeekModelPolicyInput {
  model: string;
  reasoningEffort?: string;
  temperature: number;
  topP?: number;
  frequencyPenalty?: number;
}

/** Explicit wire fields consumed by ChatDeepSeek without provider-default thinking. */
export interface DeepSeekChatModelPolicy {
  thinkingEnabled: boolean;
  temperature?: number;
  topP?: number;
  modelKwargs: Readonly<{
    thinking: Readonly<{ type: "enabled" | "disabled" }>;
    reasoning_effort?: "high" | "max";
  }>;
}

/** Returns whether one identity is in the reviewed current DeepSeek catalog. */
export function isCurrentDeepSeekModelIdentity(value: string): boolean {
  return CURRENT_DEEPSEEK_MODELS.has(value);
}

/** Returns whether one plugin reasoning setting explicitly enables DeepSeek thinking. */
export function isDeepSeekThinkingEffort(reasoningEffort: string | undefined): boolean {
  return reasoningEffort === "high" || reasoningEffort === "xhigh";
}

/** Keeps internal temperature overrides legal for an explicitly thinking DeepSeek model. */
export function resolveDeepSeekTemperatureOverride(
  reasoningEffort: string | undefined,
  requestedTemperature: number
): number {
  return isDeepSeekThinkingEffort(reasoningEffort) ? 0 : requestedTemperature;
}

/**
 * Returns whether agent tools must fail closed until DeepSeek reasoning replay is implemented.
 *
 * @param llmType - Runtime LangChain model family
 * @param modelKwargs - Provider wire configuration captured by the model instance
 * @param toolCount - Number of tools that would be bound
 */
export function shouldBlockDeepSeekThinkingAgentTools(
  llmType: unknown,
  modelKwargs: unknown,
  toolCount: number
): boolean {
  if (llmType !== "deepseek" || toolCount < 1 || typeof modelKwargs !== "object" || !modelKwargs) {
    return false;
  }
  const thinking = (modelKwargs as { thinking?: unknown }).thinking;
  return (
    typeof thinking === "object" &&
    thinking !== null &&
    (thinking as { type?: unknown }).type === "enabled"
  );
}

/**
 * Resolves explicit direct-chat thinking and sampling behavior before network I/O.
 *
 * `minimal` is the plugin's explicit "thinking disabled" setting. Thinking
 * requests omit temperature/top-p entirely; the zero temperature stored on the
 * Pro built-in is an auditable placeholder rather than a wire parameter.
 *
 * @param input - Exact selected model behavior and resolved sampling temperature
 * @returns Frozen ChatDeepSeek fields with no fallback or ignored configuration
 */
export function createDeepSeekChatModelPolicy(
  input: DeepSeekModelPolicyInput
): DeepSeekChatModelPolicy {
  if (!isCurrentDeepSeekModelIdentity(input.model)) {
    throw new DeepSeekModelPolicyError("model_unsupported");
  }
  if (input.frequencyPenalty !== undefined) {
    throw new DeepSeekModelPolicyError("frequency_penalty_unsupported");
  }

  const effort = input.reasoningEffort ?? "minimal";
  if (!(["minimal", "high", "xhigh"] as const).includes(effort as never)) {
    throw new DeepSeekModelPolicyError("reasoning_effort_unsupported");
  }
  if (isDeepSeekThinkingEffort(effort)) {
    if (input.temperature !== 0 || input.topP !== undefined) {
      throw new DeepSeekModelPolicyError("sampling_unsupported");
    }
    const reasoningEffort = effort === "xhigh" ? "max" : "high";
    return Object.freeze({
      thinkingEnabled: true,
      modelKwargs: Object.freeze({
        thinking: Object.freeze({ type: "enabled" as const }),
        reasoning_effort: reasoningEffort,
      }),
    });
  }

  if (
    !Number.isFinite(input.temperature) ||
    input.temperature < 0 ||
    input.temperature > 2 ||
    (input.topP !== undefined && (!Number.isFinite(input.topP) || input.topP < 0 || input.topP > 1))
  ) {
    throw new DeepSeekModelPolicyError("sampling_unsupported");
  }
  return Object.freeze({
    thinkingEnabled: false,
    temperature: input.temperature,
    ...(input.topP === undefined ? {} : { topP: input.topP }),
    modelKwargs: Object.freeze({
      thinking: Object.freeze({ type: "disabled" as const }),
    }),
  });
}
