import type { CustomModel } from "@/aiParams";
import { isCurrentDeepSeekModelIdentity } from "@/LLMProviders/deepseekModelPolicy";

const DIRECT_DEEPSEEK_PROVIDER = "deepseek";
const RETIRED_DIRECT_DEEPSEEK_MODELS = new Set(["deepseek-chat", "deepseek-reasoner"]);

/** Stable reasons why a persisted model reference must not fall back. */
export type SavedModelReferenceErrorCode = "model_retired" | "deepseek_model_unsupported";

/** Explicit selection failure used to prevent a saved reference from changing models silently. */
export class SavedModelReferenceError extends Error {
  /** Creates one stable saved-reference failure. */
  constructor(
    public readonly code: SavedModelReferenceErrorCode,
    public readonly modelKey: string
  ) {
    super(
      code === "model_retired"
        ? `The saved model ${modelKey} is retired. Choose a current DeepSeek V4 model.`
        : `The saved DeepSeek model ${modelKey} is unsupported. Choose a reviewed DeepSeek V4 model.`
    );
    this.name = "SavedModelReferenceError";
  }
}

/** Splits one persisted model key without treating separators inside the model name as providers. */
function splitSavedModelKey(modelKey: string): { modelName: string; provider: string } {
  const separator = modelKey.lastIndexOf("|");
  if (separator < 0) {
    return { modelName: modelKey, provider: "" };
  }
  return {
    modelName: modelKey.slice(0, separator),
    provider: modelKey.slice(separator + 1),
  };
}

/**
 * Rejects retired and unreviewed direct-DeepSeek saved references before any fallback is considered.
 *
 * @param modelKey - Persisted `name|provider` selection
 * @param model - Resolved catalog record when one still exists
 */
export function assertSavedModelReferenceCanRun(modelKey: string, model?: CustomModel): void {
  if (model?.retired === true) {
    throw new SavedModelReferenceError("model_retired", modelKey);
  }
  const parsed = splitSavedModelKey(modelKey);
  const provider = model?.provider ?? parsed.provider;
  const modelName = model?.name ?? parsed.modelName;
  if (provider === DIRECT_DEEPSEEK_PROVIDER && RETIRED_DIRECT_DEEPSEEK_MODELS.has(modelName)) {
    throw new SavedModelReferenceError("model_retired", modelKey);
  }
  if (provider === DIRECT_DEEPSEEK_PROVIDER && !isCurrentDeepSeekModelIdentity(modelName)) {
    throw new SavedModelReferenceError("deepseek_model_unsupported", modelKey);
  }
}

/** Returns whether an unknown error is a deliberate saved-model fail-closed result. */
export function isSavedModelReferenceError(error: unknown): error is SavedModelReferenceError {
  return error instanceof SavedModelReferenceError;
}

/** Returns whether one catalog record is eligible for user selection or fallback. */
export function isModelReferenceRunnable(model: CustomModel): boolean {
  try {
    assertSavedModelReferenceCanRun(`${model.name}|${model.provider}`, model);
    return true;
  } catch (error) {
    if (isSavedModelReferenceError(error)) return false;
    throw error;
  }
}

/** Finds the first enabled fallback that is neither retired nor an unreviewed direct model. */
export function findFirstRunnableFallbackModel(models: readonly CustomModel[]): CustomModel | null {
  for (const model of models) {
    if (model.enabled && isModelReferenceRunnable(model)) return model;
  }
  return null;
}
