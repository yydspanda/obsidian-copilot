import {
  KnowledgeSetupReadinessInputError,
  projectKnowledgeSetupReadiness,
  type KnowledgeSetupReadinessContext,
} from "@/knowledge/setup/KnowledgeSetupReadiness";
import type { KnowledgePluginStartupState } from "@/knowledge/startup/KnowledgePluginStartupBarrier";

type StartupStateWithoutGeneration<T> = T extends KnowledgePluginStartupState
  ? Omit<T, "generation">
  : never;

/** Creates one typed startup observation for projector tests. */
function createStartupState(
  state: StartupStateWithoutGeneration<KnowledgePluginStartupState>
): KnowledgePluginStartupState {
  return { generation: 7, ...state };
}

/** Creates the least-data edge context with a configurable ordinary Chat lane. */
function createContext(
  projectCount = 1,
  reason: KnowledgeSetupReadinessContext["chatModel"]["reason"] = "configured"
): KnowledgeSetupReadinessContext {
  return { projectCount, chatModel: { reason } };
}

describe("projectKnowledgeSetupReadiness", () => {
  it("reports startup checking without claiming provider connectivity", () => {
    const result = projectKnowledgeSetupReadiness(
      createStartupState({ status: "waiting_for_layout" }),
      createContext()
    );

    expect(result).toEqual({
      startupStatus: "waiting_for_layout",
      workspace: { level: "checking", reason: "startup_checking" },
      knowledgeModel: { level: "checking", reason: "startup_checking" },
      chatModel: { level: "locally_ready", reason: "chat_model_configured" },
      networkVerification: "not_tested",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.workspace)).toBe(true);
    expect(Object.isFrozen(result.knowledgeModel)).toBe(true);
    expect(Object.isFrozen(result.chatModel)).toBe(true);
  });

  it("distinguishes a missing Project from a Project missing its Bundle", () => {
    const state = createStartupState({ status: "bundle_unconfigured" });

    const withoutProject = projectKnowledgeSetupReadiness(state, createContext(0));
    const withoutBundle = projectKnowledgeSetupReadiness(state, createContext(2));

    expect(withoutProject.workspace).toEqual({ level: "needs_action", reason: "no_project" });
    expect(withoutProject.knowledgeModel).toEqual({
      level: "not_applicable",
      reason: "workspace_unavailable",
    });
    expect(withoutBundle.workspace).toEqual({
      level: "needs_action",
      reason: "bundle_missing",
    });
    expect(withoutBundle.knowledgeModel).toEqual({
      level: "not_applicable",
      reason: "workspace_configuration_needs_attention",
    });
  });

  it.each([
    ["runtime_unavailable", "durable_storage_unavailable"],
    ["projects_unavailable", "projects_unavailable"],
  ] as const)("keeps %s blocked before model readiness is applicable", (status, reason) => {
    const result = projectKnowledgeSetupReadiness(createStartupState({ status }), createContext());

    expect(result.workspace).toEqual({ level: "blocked", reason });
    expect(result.knowledgeModel).toEqual({
      level: "blocked",
      reason: "workspace_unavailable",
    });
  });

  it.each([
    ["project_id_invalid", "bundle_configuration_invalid"],
    ["bundle_schema_invalid", "bundle_configuration_invalid"],
    ["bundle_semantic_invalid", "bundle_configuration_invalid"],
    ["bundle_id_duplicate", "bundle_configuration_invalid"],
    ["wiki_root_overlap", "bundle_configuration_invalid"],
    ["wiki_source_overlap", "bundle_configuration_invalid"],
    ["schema_inside_wiki", "bundle_configuration_invalid"],
    ["bundle_config_load_failed", "bundle_configuration_invalid"],
    ["bundle_config_result_invalid", "bundle_configuration_invalid"],
    ["bundle_config_invalid", "bundle_configuration_invalid"],
    ["production_preflight_bundle_duplicate", "bundle_configuration_invalid"],
  ] as const)(
    "maps the known workspace diagnostic %s without blaming the model",
    (code, reason) => {
      const result = projectKnowledgeSetupReadiness(
        createStartupState({ status: "bundle_invalid", diagnosticCodes: [code] }),
        createContext()
      );

      expect(result.workspace).toEqual({ level: "needs_action", reason });
      expect(result.knowledgeModel).toEqual({
        level: "not_applicable",
        reason: "workspace_configuration_needs_attention",
      });
    }
  );

  it.each([
    [
      "production_preflight_profile_project_missing",
      "knowledge_model_configuration_invalid",
      "needs_action",
    ],
    ["production_preflight_profile_model_key_invalid", "knowledge_model_missing", "needs_action"],
    ["production_preflight_profile_model_missing", "knowledge_model_missing", "needs_action"],
    ["production_preflight_profile_model_ambiguous", "knowledge_model_ambiguous", "needs_action"],
    ["production_preflight_profile_model_disabled", "knowledge_model_disabled", "needs_action"],
    [
      "production_preflight_profile_model_not_project_enabled",
      "knowledge_model_not_project_enabled",
      "needs_action",
    ],
    [
      "production_preflight_profile_provider_unsupported",
      "knowledge_model_unsupported",
      "needs_action",
    ],
    [
      "production_preflight_profile_model_unsupported",
      "knowledge_model_unsupported",
      "needs_action",
    ],
    ["production_preflight_model_unsupported", "knowledge_model_unsupported", "needs_action"],
    ["production_preflight_route_model_unsupported", "knowledge_model_unsupported", "needs_action"],
    [
      "production_preflight_profile_configuration_unsupported",
      "knowledge_model_configuration_invalid",
      "needs_action",
    ],
    [
      "production_preflight_profile_model_behavior_invalid",
      "knowledge_model_configuration_invalid",
      "needs_action",
    ],
    [
      "production_preflight_route_profile_invalid",
      "knowledge_model_configuration_invalid",
      "needs_action",
    ],
    [
      "production_preflight_route_configuration_unsupported",
      "knowledge_model_configuration_invalid",
      "needs_action",
    ],
    ["production_preflight_input_invalid", "knowledge_model_configuration_invalid", "needs_action"],
    [
      "production_preflight_profile_input_invalid",
      "knowledge_model_configuration_invalid",
      "needs_action",
    ],
    [
      "production_preflight_profile_endpoint_invalid",
      "knowledge_model_endpoint_invalid",
      "needs_action",
    ],
    [
      "production_preflight_route_endpoint_mismatch",
      "knowledge_model_endpoint_invalid",
      "needs_action",
    ],
    [
      "production_preflight_route_credential_invalid",
      "knowledge_model_credential_missing",
      "needs_action",
    ],
    [
      "production_preflight_route_dependency_invalid",
      "knowledge_model_route_unavailable",
      "blocked",
    ],
    ["production_preflight_route_invalid", "knowledge_model_route_unavailable", "blocked"],
    ["production_preflight_closed", "knowledge_model_route_unavailable", "blocked"],
  ] as const)("maps the known model diagnostic %s to %s", (code, reason, level) => {
    const result = projectKnowledgeSetupReadiness(
      createStartupState({ status: "bundle_invalid", diagnosticCodes: [code] }),
      createContext()
    );

    expect(result.workspace).toEqual({ level: "locally_ready", reason: "workspace_ready" });
    expect(result.knowledgeModel).toEqual({ level, reason });
  });

  it("projects mixed known diagnostics independently and applies deterministic model priority", () => {
    const result = projectKnowledgeSetupReadiness(
      createStartupState({
        status: "bundle_invalid",
        diagnosticCodes: [
          "bundle_schema_invalid",
          "production_preflight_profile_model_disabled",
          "production_preflight_route_credential_invalid",
        ],
      }),
      createContext()
    );

    expect(result.workspace).toEqual({
      level: "needs_action",
      reason: "bundle_configuration_invalid",
    });
    expect(result.knowledgeModel).toEqual({
      level: "needs_action",
      reason: "knowledge_model_credential_missing",
    });
  });

  it("maps an unknown diagnostic to a generic result without retaining its text", () => {
    const rawDiagnostic = "C:\\private-vault\\project.md";
    const result = projectKnowledgeSetupReadiness(
      createStartupState({
        status: "bundle_invalid",
        diagnosticCodes: [rawDiagnostic],
      }),
      createContext()
    );

    expect(result.workspace).toEqual({
      level: "needs_action",
      reason: "configuration_needs_attention",
    });
    expect(result.knowledgeModel).toEqual({
      level: "needs_action",
      reason: "configuration_needs_attention",
    });
    expect(JSON.stringify(result)).not.toContain(rawDiagnostic);
  });

  it.each([
    ["recovery_unavailable", "recovery_unavailable"],
    ["recovery_attention_required", "recovery_attention_required"],
    ["recovery_blocked", "recovery_blocked"],
    ["source_recovery_required", "source_recovery_required"],
    ["workflow_adapters_unavailable", "workflow_adapters_unavailable"],
  ] as const)(
    "keeps %s operationally blocked without misdiagnosing configuration",
    (status, reason) => {
      let state: KnowledgePluginStartupState;
      switch (status) {
        case "recovery_unavailable":
          state = createStartupState({ status, bundleIds: ["personal"], diagnosticCodes: ["x"] });
          break;
        case "recovery_attention_required":
        case "recovery_blocked":
          state = createStartupState({
            status,
            bundleIds: ["personal"],
            recoveryBundleId: "personal",
            attentionKinds: ["accepted_not_started"],
          });
          break;
        case "source_recovery_required":
          state = createStartupState({
            status,
            bundleIds: ["personal"],
            sourceRecoveryBundleId: "personal",
            blockerKinds: ["source_observation_pending"],
          });
          break;
        case "workflow_adapters_unavailable":
          state = createStartupState({ status, bundleIds: ["personal"] });
          break;
      }

      const result = projectKnowledgeSetupReadiness(state, createContext());

      expect(result.workspace).toEqual({ level: "blocked", reason });
      expect(result.knowledgeModel).toEqual({
        level: "locally_ready",
        reason: "knowledge_model_configured",
      });
    }
  );

  it("reports a unique read-ready Bundle as locally ready but network-untested", () => {
    const result = projectKnowledgeSetupReadiness(
      createStartupState({ status: "workflow_read_ready", bundleIds: ["personal"] }),
      createContext()
    );

    expect(result.workspace).toEqual({ level: "locally_ready", reason: "workspace_ready" });
    expect(result.knowledgeModel).toEqual({
      level: "locally_ready",
      reason: "knowledge_model_configured",
    });
    expect(result.networkVerification).toBe("not_tested");
  });

  it("requires explicit selection when more than one configured Bundle is ready", () => {
    const result = projectKnowledgeSetupReadiness(
      createStartupState({
        status: "workflow_read_ready",
        bundleIds: ["personal", "research"],
      }),
      createContext()
    );

    expect(result.workspace).toEqual({ level: "needs_action", reason: "multiple_bundles" });
    expect(result.knowledgeModel).toEqual({
      level: "locally_ready",
      reason: "knowledge_model_configured",
    });
  });

  it.each(["recovery_attention_required", "recovery_blocked"] as const)(
    "preserves exact %s attention when several Bundles are configured",
    (status) => {
      const result = projectKnowledgeSetupReadiness(
        createStartupState({
          status,
          bundleIds: ["personal", "research"],
          recoveryBundleId: "research",
          attentionKinds: ["transaction_active"],
        }),
        createContext(2)
      );

      expect(result.workspace).toEqual({ level: "blocked", reason: status });
      expect(result.knowledgeModel).toEqual({
        level: "locally_ready",
        reason: "knowledge_model_configured",
      });
    }
  );

  it("preserves source recovery attention when several Bundles are configured", () => {
    const result = projectKnowledgeSetupReadiness(
      createStartupState({
        status: "source_recovery_required",
        bundleIds: ["personal", "research"],
        sourceRecoveryBundleId: "research",
        blockerKinds: ["source_observation_pending"],
      }),
      createContext(2)
    );

    expect(result.workspace).toEqual({
      level: "blocked",
      reason: "source_recovery_required",
    });
  });

  it.each([
    ["missing", "chat_model_missing", "needs_action"],
    ["ambiguous", "chat_model_ambiguous", "needs_action"],
    ["disabled", "chat_model_disabled", "needs_action"],
    ["unsupported", "chat_model_unsupported", "needs_action"],
    ["not_project_enabled", "chat_model_not_project_enabled", "needs_action"],
    ["credential_missing", "chat_model_credential_missing", "needs_action"],
    ["configured", "chat_model_configured", "locally_ready"],
  ] as const)(
    "keeps optional Chat reason %s separate from ready Knowledge",
    (input, reason, level) => {
      const result = projectKnowledgeSetupReadiness(
        createStartupState({ status: "workflow_read_ready", bundleIds: ["personal"] }),
        createContext(1, input)
      );

      expect(result.chatModel).toEqual({ level, reason });
      expect(result.workspace.level).toBe("locally_ready");
      expect(result.knowledgeModel.level).toBe("locally_ready");
    }
  );

  it("rejects malformed plain context without retaining caller values", () => {
    const rawValue = "private-model-key";
    const context = {
      projectCount: 1,
      chatModel: { reason: rawValue },
    } as unknown as KnowledgeSetupReadinessContext;

    expect(() =>
      projectKnowledgeSetupReadiness(createStartupState({ status: "waiting_for_layout" }), context)
    ).toThrow(KnowledgeSetupReadinessInputError);
    try {
      projectKnowledgeSetupReadiness(createStartupState({ status: "waiting_for_layout" }), context);
    } catch (error) {
      expect(String(error)).not.toContain(rawValue);
    }
  });

  it("does not execute context accessors", () => {
    const getter = jest.fn(() => ({ reason: "configured" }));
    const context = { projectCount: 1 } as Record<string, unknown>;
    Object.defineProperty(context, "chatModel", { enumerable: true, get: getter });

    expect(() =>
      projectKnowledgeSetupReadiness(
        createStartupState({ status: "waiting_for_layout" }),
        context as unknown as KnowledgeSetupReadinessContext
      )
    ).toThrow(KnowledgeSetupReadinessInputError);
    expect(getter).not.toHaveBeenCalled();
  });
});
