import {
  projectKnowledgeChatModelReadiness,
  type KnowledgeChatModelReadinessCandidateInput,
  type KnowledgeChatModelReadinessInput,
  type KnowledgeChatModelReadinessReason,
} from "@/knowledge/setup/KnowledgeChatModelReadiness";

const MODEL_KEY = "chat-model|provider";

/** Creates one complete secret-free candidate with explicit test overrides. */
function createCandidate(
  overrides: Partial<KnowledgeChatModelReadinessCandidateInput> = {}
): KnowledgeChatModelReadinessCandidateInput {
  return {
    modelKey: MODEL_KEY,
    enabled: true,
    supported: true,
    projectEnabled: true,
    credentialConfigured: true,
    ...overrides,
  };
}

describe("projectKnowledgeChatModelReadiness", () => {
  it.each<{
    label: string;
    input: KnowledgeChatModelReadinessInput;
    expected: KnowledgeChatModelReadinessReason;
  }>([
    {
      label: "reports a missing default selection",
      input: { selection: { mode: "default", selectedModelKey: null }, activeModels: [] },
      expected: "missing",
    },
    {
      label: "reports a missing exact model",
      input: {
        selection: { mode: "default", selectedModelKey: MODEL_KEY },
        activeModels: [createCandidate({ modelKey: `${MODEL_KEY}-other` })],
      },
      expected: "missing",
    },
    {
      label: "fails closed when the exact identity is duplicated",
      input: {
        selection: { mode: "default", selectedModelKey: MODEL_KEY },
        activeModels: [createCandidate(), createCandidate()],
      },
      expected: "ambiguous",
    },
    {
      label: "reports a disabled exact model",
      input: {
        selection: { mode: "default", selectedModelKey: MODEL_KEY },
        activeModels: [createCandidate({ enabled: false })],
      },
      expected: "disabled",
    },
    {
      label: "reports an unsupported saved reference",
      input: {
        selection: { mode: "default", selectedModelKey: MODEL_KEY },
        activeModels: [createCandidate({ supported: false })],
      },
      expected: "unsupported",
    },
    {
      label: "reports a missing local credential",
      input: {
        selection: { mode: "default", selectedModelKey: MODEL_KEY },
        activeModels: [createCandidate({ credentialConfigured: false })],
      },
      expected: "credential_missing",
    },
    {
      label: "reports a configured default Chat selection",
      input: {
        selection: { mode: "default", selectedModelKey: MODEL_KEY },
        activeModels: [createCandidate({ projectEnabled: false })],
      },
      expected: "configured",
    },
    {
      label: "does not fall back when the Project selection is missing",
      input: {
        selection: { mode: "project", projectModelKey: "missing|provider" },
        activeModels: [createCandidate()],
      },
      expected: "missing",
    },
    {
      label: "requires explicit Project enablement",
      input: {
        selection: { mode: "project", projectModelKey: MODEL_KEY },
        activeModels: [createCandidate({ projectEnabled: false })],
      },
      expected: "not_project_enabled",
    },
    {
      label: "reports a configured exact Project selection",
      input: {
        selection: { mode: "project", projectModelKey: MODEL_KEY },
        activeModels: [createCandidate()],
      },
      expected: "configured",
    },
  ])("$label", ({ input, expected }) => {
    expect(projectKnowledgeChatModelReadiness(input)).toEqual({ reason: expected });
  });

  it("returns a frozen reason-only result that retains no identity or secret canary", () => {
    const secretCanary = "SECRET_API_KEY_CANARY";
    const input = {
      selection: { mode: "default" as const, selectedModelKey: secretCanary },
      activeModels: [createCandidate({ modelKey: secretCanary })],
    };

    const result = projectKnowledgeChatModelReadiness(input);

    expect(result).toEqual({ reason: "configured" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).toEqual(["reason"]);
    expect(JSON.stringify(result)).not.toContain(secretCanary);
  });

  it("uses exact model identity without trimming or case normalization", () => {
    const input: KnowledgeChatModelReadinessInput = {
      selection: { mode: "default", selectedModelKey: MODEL_KEY },
      activeModels: [
        createCandidate({ modelKey: ` ${MODEL_KEY}` }),
        createCandidate({ modelKey: MODEL_KEY.toUpperCase() }),
      ],
    };

    expect(projectKnowledgeChatModelReadiness(input)).toEqual({ reason: "missing" });
  });
});
