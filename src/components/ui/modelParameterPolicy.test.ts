import {
  createReasoningEffortModelUpdate,
  getModelParameterUiPolicy,
  getProjectTemperatureControl,
  normalizeProjectModelConfigsForSelection,
} from "@/components/ui/modelParameterPolicy";
import { ReasoningEffort } from "@/constants";

describe("model parameter UI policy", () => {
  it("offers only reviewed DeepSeek effort values", () => {
    const policy = getModelParameterUiPolicy({
      provider: "deepseek",
      reasoningEffort: ReasoningEffort.MINIMAL,
    });

    expect(policy.reasoningEffortOptions?.map((option) => option.value)).toEqual([
      ReasoningEffort.MINIMAL,
      ReasoningEffort.HIGH,
      ReasoningEffort.XHIGH,
    ]);
    expect(policy.showTemperature).toBe(true);
    expect(policy.showTopP).toBe(true);
    expect(policy.showFrequencyPenalty).toBe(false);
  });

  it("removes sampling controls and resets their fields in thinking mode", () => {
    const policy = getModelParameterUiPolicy({
      provider: "deepseek",
      reasoningEffort: ReasoningEffort.HIGH,
    });
    const update = createReasoningEffortModelUpdate({ provider: "deepseek" }, ReasoningEffort.HIGH);

    expect(policy).toMatchObject({
      thinkingEnabled: true,
      showTemperature: false,
      showTopP: false,
      showFrequencyPenalty: false,
    });
    expect(update.updates).toEqual({ reasoningEffort: ReasoningEffort.HIGH, temperature: 0 });
    expect(update.resetFields).toEqual(["topP", "frequencyPenalty"]);
  });

  it("locks a selected thinking project's temperature to zero", () => {
    const selectedModel = {
      provider: "deepseek",
      reasoningEffort: ReasoningEffort.HIGH,
    };

    expect(normalizeProjectModelConfigsForSelection({ temperature: 0.1 }, selectedModel)).toEqual({
      temperature: 0,
    });
    expect(getProjectTemperatureControl(selectedModel, 0.1, 0.1)).toEqual({
      value: 0,
      disabled: true,
    });
  });
});
