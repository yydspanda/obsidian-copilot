import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { KnowledgeSetupPanel } from "@/components/knowledge/KnowledgeSetupPanel";
import type { KnowledgeSetupNavigationPort } from "@/knowledge/setup/KnowledgeSetupNavigationPort";
import {
  projectKnowledgeSetupReadiness,
  type KnowledgeSetupReadinessProjection,
} from "@/knowledge/setup/KnowledgeSetupReadiness";
import { KnowledgeSetupReadinessStore } from "@/knowledge/setup/KnowledgeSetupReadinessStore";

const READY_PROJECTION: KnowledgeSetupReadinessProjection = {
  startupStatus: "workflow_read_ready",
  workspace: { level: "locally_ready", reason: "workspace_ready" },
  knowledgeModel: { level: "locally_ready", reason: "knowledge_model_configured" },
  chatModel: { level: "locally_ready", reason: "chat_model_configured" },
  networkVerification: "not_tested",
};

/** Creates a navigation spy with no settings, file, or model authority. */
function createNavigation(): KnowledgeSetupNavigationPort & {
  [Key in keyof KnowledgeSetupNavigationPort]: jest.Mock;
} {
  return {
    openCopilotSettings: jest.fn(),
    openProjectFile: jest.fn(),
    openSchema: jest.fn(),
    openChat: jest.fn(),
    refreshDisplayedStatus: jest.fn(),
  };
}

describe("KnowledgeSetupPanel", () => {
  it("explains the three separate local readiness lanes without claiming a network test", () => {
    const navigation = createNavigation();
    render(
      <KnowledgeSetupPanel
        navigation={navigation}
        readiness={new KnowledgeSetupReadinessStore(READY_PROJECTION)}
      />
    );

    expect(screen.getByRole("heading", { name: "Knowledge Studio setup & status" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Knowledge model" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Chat model (optional)" })).toBeTruthy();
    expect(screen.getAllByText("Configured locally")).toHaveLength(3);
    expect(screen.getByRole("note").textContent).toContain("sent no model request");
    expect(screen.getByRole("note").textContent).toContain("connectivity");
  });

  it("delegates only the navigation needed for missing credentials and optional Chat", () => {
    const navigation = createNavigation();
    const readiness = new KnowledgeSetupReadinessStore({
      ...READY_PROJECTION,
      knowledgeModel: { level: "needs_action", reason: "knowledge_model_credential_missing" },
      chatModel: { level: "needs_action", reason: "chat_model_credential_missing" },
    });
    render(<KnowledgeSetupPanel navigation={navigation} readiness={readiness} />);

    const settingsButtons = screen.getAllByRole("button", { name: "Open Copilot settings" });
    expect(settingsButtons).toHaveLength(2);
    fireEvent.click(settingsButtons[0]);
    fireEvent.click(screen.getByRole("button", { name: "Open Chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh displayed status" }));

    expect(navigation.openCopilotSettings).toHaveBeenCalledTimes(1);
    expect(navigation.openChat).toHaveBeenCalledTimes(1);
    expect(navigation.refreshDisplayedStatus).toHaveBeenCalledTimes(1);
    expect(navigation.openProjectFile).not.toHaveBeenCalled();
    expect(navigation.openSchema).not.toHaveBeenCalled();
  });

  it("updates from store publication without inferring readiness optimistically", () => {
    const readiness = new KnowledgeSetupReadinessStore({
      startupStatus: "bundle_unconfigured",
      workspace: { level: "needs_action", reason: "bundle_missing" },
      knowledgeModel: {
        level: "not_applicable",
        reason: "workspace_configuration_needs_attention",
      },
      chatModel: { level: "locally_ready", reason: "chat_model_configured" },
      networkVerification: "not_tested",
    });
    render(<KnowledgeSetupPanel navigation={createNavigation()} readiness={readiness} />);

    expect(screen.getByText(/none contains one complete Knowledge Bundle/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Open Chat" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Open selected Project file" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Knowledge rules" })).toBeNull();
    expect(screen.getAllByText("Configured locally")).toHaveLength(1);

    act(() => readiness.publish(READY_PROJECTION));

    expect(screen.queryByText(/none contains one complete Knowledge Bundle/)).toBeNull();
    expect(screen.getAllByText("Configured locally")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Open Knowledge rules" })).toBeTruthy();
  });

  it("renders only closed copy when a startup diagnostic contains private text", () => {
    const privateDiagnostic = "C:\\private-vault\\owner\\project.md";
    const readiness = new KnowledgeSetupReadinessStore(
      projectKnowledgeSetupReadiness(
        { generation: 3, status: "bundle_invalid", diagnosticCodes: [privateDiagnostic] },
        { projectCount: 1, chatModel: { reason: "configured" } }
      )
    );

    const { container } = render(
      <KnowledgeSetupPanel navigation={createNavigation()} readiness={readiness} />
    );

    expect(container.textContent).not.toContain(privateDiagnostic);
    expect(container.textContent).not.toContain("private-vault");
    expect(screen.getAllByText(/configuration needs attention/).length).toBeGreaterThan(0);
  });

  it("presents durable failures as blocked attention, not automatic configuration repair", () => {
    const navigation = createNavigation();
    const readiness = new KnowledgeSetupReadinessStore({
      startupStatus: "recovery_blocked",
      workspace: { level: "blocked", reason: "recovery_blocked" },
      knowledgeModel: { level: "locally_ready", reason: "knowledge_model_configured" },
      chatModel: { level: "locally_ready", reason: "chat_model_configured" },
      networkVerification: "not_tested",
    });
    render(
      <KnowledgeSetupPanel
        navigation={navigation}
        readiness={readiness}
        unavailableNotice="Durable recovery is blocked."
      />
    );

    expect(screen.getByRole("heading", { name: "Knowledge Studio needs attention" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Durable recovery is blocked.");
    expect(screen.getByText(/no automatic repair was attempted/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Project file" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Knowledge rules" })).toBeNull();
  });

  it("returns from an embedded status overlay through the supplied local callback", () => {
    const onBack = jest.fn();
    render(
      <KnowledgeSetupPanel
        navigation={createNavigation()}
        readiness={new KnowledgeSetupReadinessStore(READY_PROJECTION)}
        onBack={onBack}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to Studio" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders unload as a blocked action-free terminal state", () => {
    const navigation = createNavigation();
    const readiness = new KnowledgeSetupReadinessStore({
      startupStatus: "plugin_unloaded",
      workspace: { level: "blocked", reason: "plugin_unloaded" },
      knowledgeModel: { level: "blocked", reason: "plugin_unloaded" },
      chatModel: { level: "blocked", reason: "plugin_unloaded" },
      networkVerification: "not_tested",
    });

    render(
      <KnowledgeSetupPanel
        navigation={navigation}
        onBack={jest.fn()}
        readiness={readiness}
        unavailableNotice="Knowledge Studio is unavailable because the plugin is unloading."
      />
    );

    expect(screen.getByRole("alert").textContent).toContain("plugin is unloading");
    expect(screen.getAllByText("Needs attention")).toHaveLength(3);
    expect(screen.queryByText("Configured locally")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
