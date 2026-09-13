/**
 * Canonical model identity sent by the direct DeepSeek provider integration.
 * https://github.com/yydspanda/obsidian-copilot/issues/3
 */
export const DEEPSEEK_FLASH_WIRE_IDENTITY = "deepseek-flash" as const;

/**
 * Official DeepSeek model identities accepted for newly configured models.
 * https://github.com/yydspanda/obsidian-copilot/issues/3
 */
export const CURRENT_DEEPSEEK_MODEL_IDENTITIES = Object.freeze([
  DEEPSEEK_FLASH_WIRE_IDENTITY,
] as const);

/**
 * DeepSeek identities accepted from current or already-persisted configuration.
 *
 * Existing vaults may retain the former Flash alias while requests use the
 * canonical identity; no other retired identity is substituted.
 * https://github.com/yydspanda/obsidian-copilot/issues/3
 */
export const SUPPORTED_DEEPSEEK_MODEL_IDENTITIES = Object.freeze([
  DEEPSEEK_FLASH_WIRE_IDENTITY,
  "deepseek-v4-flash",
] as const);

const CURRENT_DEEPSEEK_MODELS = new Set<string>(CURRENT_DEEPSEEK_MODEL_IDENTITIES);
const SUPPORTED_DEEPSEEK_MODELS = new Set<string>(SUPPORTED_DEEPSEEK_MODEL_IDENTITIES);

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
  wireModelIdentity: typeof DEEPSEEK_FLASH_WIRE_IDENTITY;
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

/**
 * Resolves current and compatible persisted identities to the reviewed wire model.
 * https://github.com/yydspanda/obsidian-copilot/issues/3
 *
 * @param value - Model identity from a saved selection, catalog, or official request.
 */
export function resolveDeepSeekWireModelIdentity(
  value: string
): typeof DEEPSEEK_FLASH_WIRE_IDENTITY | undefined {
  return SUPPORTED_DEEPSEEK_MODELS.has(value) ? DEEPSEEK_FLASH_WIRE_IDENTITY : undefined;
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
 * requests omit temperature/top-p entirely; their zero temperature is an
 * auditable internal placeholder rather than a wire parameter.
 *
 * @param input - Exact selected model behavior and resolved sampling temperature
 * @returns Frozen ChatDeepSeek fields with no fallback or ignored configuration
 */
export function createDeepSeekChatModelPolicy(
  input: DeepSeekModelPolicyInput
): DeepSeekChatModelPolicy {
  // Persisted Flash configurations remain routable only through the reviewed canonical identity.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  const wireModelIdentity = resolveDeepSeekWireModelIdentity(input.model);
  if (!wireModelIdentity) {
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
      wireModelIdentity,
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
    wireModelIdentity,
    thinkingEnabled: false,
    temperature: input.temperature,
    ...(input.topP === undefined ? {} : { topP: input.topP }),
    modelKwargs: Object.freeze({
      thinking: Object.freeze({ type: "disabled" as const }),
    }),
  });
}
