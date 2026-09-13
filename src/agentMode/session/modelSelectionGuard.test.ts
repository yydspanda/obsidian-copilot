import { assertSessionModelSelectionSupported } from "@/agentMode/session/modelSelectionGuard";
import type { BackendDescriptor, ModelSelection } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";

const CURRENT: ModelSelection = { baseModelId: "deepseek/deepseek-flash", effort: null };
const LEGACY: ModelSelection = { baseModelId: "deepseek/deepseek-v4-flash", effort: null };
const RETIRED: ModelSelection = { baseModelId: "deepseek/deepseek-v4-pro", effort: null };
const POLICY: Pick<BackendDescriptor, "normalizeSelection"> = {
  normalizeSelection: (selection) => {
    if (selection.baseModelId === RETIRED.baseModelId) return null;
    return selection.baseModelId === LEGACY.baseModelId ? CURRENT : selection;
  },
};

function settings(defaultModel: ModelSelection | null = null): CopilotSettings {
  return { agentMode: { backends: { opencode: { defaultModel } } } } as CopilotSettings;
}

describe("modelSelectionGuard", () => {
  describe("assertSessionModelSelectionSupported()", () => {
    it("allows confirmed models and leaves backends without a normalization policy unchanged", () => {
      expect(() =>
        assertSessionModelSelectionSupported(POLICY, CURRENT, settings(LEGACY), "opencode")
      ).not.toThrow();
      expect(() =>
        assertSessionModelSelectionSupported(undefined, RETIRED, settings(RETIRED), "opencode")
      ).not.toThrow();
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 rejects an invalid persisted default even while the backend still reports a supported current model", () => {
      expect(() =>
        assertSessionModelSelectionSupported(POLICY, CURRENT, settings(RETIRED), "opencode")
      ).toThrow("saved model selection is no longer supported");
    });

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 checks only the saved preference for the session's own backend", () => {
      expect(() =>
        assertSessionModelSelectionSupported(POLICY, CURRENT, settings(RETIRED), "another-backend")
      ).not.toThrow();
    });

    it.each([RETIRED, LEGACY])(
      "https://github.com/yydspanda/obsidian-copilot/issues/3 rejects an unconfirmed backend identity $baseModelId",
      (current) => {
        expect(() =>
          assertSessionModelSelectionSupported(POLICY, current, settings(), "opencode")
        ).toThrow("backend selected a model that is no longer supported");
      }
    );

    it("https://github.com/yydspanda/obsidian-copilot/issues/3 checks an invalid default even when the backend has no current model report", () => {
      expect(() =>
        assertSessionModelSelectionSupported(POLICY, undefined, settings(RETIRED), "opencode")
      ).toThrow("saved model selection is no longer supported");
      expect(() =>
        assertSessionModelSelectionSupported(POLICY, undefined, settings(), "opencode")
      ).not.toThrow();
    });
  });
});
