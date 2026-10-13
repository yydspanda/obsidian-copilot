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
  "deepseek-v4-pro",
] as const);

export type DeepSeekWireModelIdentity = (typeof CURRENT_DEEPSEEK_MODEL_IDENTITIES)[number];

/**
 * DeepSeek identities accepted from current or already-persisted configuration.
 *
 * Existing vaults may retain the former Flash alias while requests use the
 * canonical identity; no other retired identity is substituted.
 * https://github.com/yydspanda/obsidian-copilot/issues/3
 */
export const SUPPORTED_DEEPSEEK_MODEL_IDENTITIES = Object.freeze([
  ...CURRENT_DEEPSEEK_MODEL_IDENTITIES,
  "deepseek-v4-flash",
] as const);

const CURRENT_DEEPSEEK_MODELS = new Set<string>(CURRENT_DEEPSEEK_MODEL_IDENTITIES);

export type DeepSeekModelPolicyErrorCode =
  | "model_unsupported"
  | "reasoning_effort_unsupported"
  | "sampling_unsupported"
  | "frequency_penalty_unsupported";

export class DeepSeekModelPolicyError extends TypeError {
  constructor(public readonly code: DeepSeekModelPolicyErrorCode) {
    super("The DeepSeek model configuration is not supported");
    this.name = "DeepSeekModelPolicyError";
  }
}

export interface DeepSeekModelPolicyInput {
  model: string;
  reasoningEffort?: string;
  temperature: number;
  topP?: number;
  frequencyPenalty?: number;
}

export interface DeepSeekChatModelPolicy {
  wireModelIdentity: DeepSeekWireModelIdentity;
  thinkingEnabled: boolean;
  temperature?: number;
  topP?: number;
  modelKwargs: Readonly<{
    thinking: Readonly<{ type: "enabled" | "disabled" }>;
    reasoning_effort?: "high" | "max";
  }>;
}

export function isCurrentDeepSeekModelIdentity(value: string): value is DeepSeekWireModelIdentity {
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
): DeepSeekWireModelIdentity | undefined {
  // Only Flash has an alias: continued Pro service must keep its own model identity.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  if (value === "deepseek-v4-flash") return DEEPSEEK_FLASH_WIRE_IDENTITY;
  return isCurrentDeepSeekModelIdentity(value) ? value : undefined;
}

export function isDeepSeekThinkingEffort(reasoningEffort: string | undefined): boolean {
  return reasoningEffort === "high" || reasoningEffort === "xhigh";
}

export function resolveDeepSeekTemperatureOverride(
  reasoningEffort: string | undefined,
  requestedTemperature: number
): number {
  return isDeepSeekThinkingEffort(reasoningEffort) ? 0 : requestedTemperature;
}

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

export function createDeepSeekChatModelPolicy(
  input: DeepSeekModelPolicyInput
): DeepSeekChatModelPolicy {
  // Resolve only the reviewed Flash alias; never replace the user's selected model tier.
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
