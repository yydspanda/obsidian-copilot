import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { KnowledgeRecoveryPanel } from "@/components/knowledge/KnowledgeRecoveryPanel";
import type { KnowledgeRecoveryItem, KnowledgeRecoveryModel } from "@/knowledge/ui/recoveryModel";

/**
 * Creates one immutable recovery item with fail-closed defaults.
 *
 * @param overrides - Fields that distinguish the recovery condition
 * @returns Complete recovery row fixture
 */
function createItem(overrides: Partial<KnowledgeRecoveryItem>): Readonly<KnowledgeRecoveryItem> {
  return {
    id: "recovery-1",
    status: "transaction_active",
    actions: { canContinue: false, canAbandon: false },
    ...overrides,
  };
}

/**
 * Creates one complete recovery model fixture.
 *
 * @param items - Recovery rows rendered by the panel
 * @returns Immutable recovery model
 */
function createModel(
  items: readonly Readonly<KnowledgeRecoveryItem>[]
): Readonly<KnowledgeRecoveryModel> {
  return {
    bundleId: "personal",
    runtimeRevision: 42,
    items,
  };
}

/**
 * Renders the panel with fresh callback spies.
 *
 * @param model - Recovery model under test
 * @param pendingRecoveryId - Optional in-flight recovery identity
 * @returns Callback spies owned by this render
 */
function renderPanel(model: Readonly<KnowledgeRecoveryModel>, pendingRecoveryId?: string) {
  const onContinue = jest.fn<void, [string]>();
  const onAbandon = jest.fn<void, [string]>();
  const onRefresh = jest.fn<void, []>();
  render(
    <KnowledgeRecoveryPanel
      model={model}
      onAbandon={onAbandon}
      onContinue={onContinue}
      onRefresh={onRefresh}
      pendingRecoveryId={pendingRecoveryId}
    />
  );
  return { onContinue, onAbandon, onRefresh };
}

/** Returns one named button with its concrete disabled-state type. */
function getButton(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name });
}

describe("KnowledgeRecoveryPanel", () => {
  it("renders every actionable, active, blocked, finalizing, global, and Queue condition", () => {
    const items = [
      createItem({
        id: "accepted-1",
        status: "accepted_not_started",
        changeSetId: "changeset-accepted",
        actions: { canContinue: true, canAbandon: false },
      }),
      createItem({
        id: "decision-1",
        status: "decision_required",
        changeSetId: "changeset-decision",
        actions: { canContinue: true, canAbandon: true },
      }),
      createItem({
        id: "active-1",
        status: "transaction_active",
        transactionId: "transaction-active",
        phase: "applying",
      }),
      createItem({
        id: "blocked-1",
        status: "apply_blocked",
        transactionId: "transaction-blocked",
        blockedReason: "other_transaction_active",
      }),
      createItem({
        id: "finalizing-1",
        status: "commit_finalizing",
        transactionId: "transaction-finalizing",
        phase: "committed",
      }),
      createItem({
        id: "global-1",
        status: "global_transaction",
        transactionId: "transaction-global",
        phase: "prepared",
      }),
      createItem({ id: "queue-recovery-1", status: "queue_recovery_required" }),
      createItem({ id: "queue-commit-1", status: "queue_commit_pending_ack" }),
    ];

    renderPanel(createModel(items));

    expect(screen.getByRole("heading", { name: "Knowledge recovery" })).toBeTruthy();
    expect(screen.getByText(/bundle personal · runtime revision 42/)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    for (const label of [
      "Accepted, not started",
      "Decision required",
      "Transaction active",
      "Apply blocked",
      "Commit finalizing",
      "Global transaction",
      "Queue recovery required",
      "Queue commit pending",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("Change set changeset-accepted")).toBeTruthy();
    expect(screen.getByText("Transaction transaction-active")).toBeTruthy();
    expect(screen.getByText("Phase applying")).toBeTruthy();
    expect(screen.getByText(/Another transaction owns the global write slot/)).toBeTruthy();
    expect(getButton("Continue accepted-1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abandon accepted-1" })).toBeNull();
    expect(getButton("Continue decision-1")).toBeTruthy();
    expect(getButton("Abandon decision-1")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Check again/ })).toHaveLength(6);
    expect(screen.queryByRole("button", { name: /roll\s*back/i })).toBeNull();
  });

  it("delegates explicit recovery ids and keeps rechecks value-free", () => {
    const items = [
      createItem({
        id: "accepted-1",
        status: "accepted_not_started",
        actions: { canContinue: true, canAbandon: false },
      }),
      createItem({
        id: "decision-1",
        status: "decision_required",
        actions: { canContinue: true, canAbandon: true },
      }),
      createItem({ id: "active-1", status: "transaction_active" }),
      createItem({ id: "blocked-1", status: "apply_blocked" }),
    ];
    const callbacks = renderPanel(createModel(items));

    fireEvent.click(getButton("Continue accepted-1"));
    fireEvent.click(getButton("Continue decision-1"));
    fireEvent.click(getButton("Abandon decision-1"));
    fireEvent.click(getButton("Check again active-1"));
    fireEvent.click(getButton("Check again blocked-1"));

    expect(callbacks.onContinue.mock.calls).toEqual([["accepted-1"], ["decision-1"]]);
    expect(callbacks.onAbandon).toHaveBeenCalledWith("decision-1");
    expect(callbacks.onRefresh).toHaveBeenCalledTimes(2);
    expect(callbacks.onRefresh.mock.calls).toEqual([[], []]);
  });

  it("fails closed when blocked states or action flags are inconsistent", () => {
    const items = [
      createItem({
        id: "blocked-with-flags",
        status: "apply_blocked",
        actions: { canContinue: true, canAbandon: true },
      }),
      createItem({
        id: "decision-without-flags",
        status: "decision_required",
        actions: { canContinue: false, canAbandon: false },
      }),
    ];

    renderPanel(createModel(items));

    for (const item of items) {
      const row = screen.getByText(`Recovery ${item.id}`).closest("li");
      if (!row) throw new Error("Expected a recovery list item");
      expect(within(row).queryByRole("button", { name: /Continue/ })).toBeNull();
      expect(within(row).queryByRole("button", { name: /Abandon/ })).toBeNull();
      expect(within(row).getByRole("button", { name: `Check again ${item.id}` })).toBeTruthy();
    }
  });

  it("marks the matching row busy and suppresses concurrent recovery commands", () => {
    const items = [
      createItem({
        id: "accepted-1",
        status: "accepted_not_started",
        actions: { canContinue: true, canAbandon: false },
      }),
      createItem({
        id: "decision-1",
        status: "decision_required",
        actions: { canContinue: true, canAbandon: true },
      }),
      createItem({ id: "active-1", status: "transaction_active" }),
    ];

    renderPanel(createModel(items), "decision-1");

    const pendingRow = screen.getByText("Recovery decision-1").closest("li");
    if (!pendingRow) throw new Error("Expected the pending recovery row");
    expect(pendingRow.getAttribute("aria-busy")).toBe("true");
    expect(
      screen.getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled)
    ).toBe(true);
  });

  it("renders an empty durable state with a refresh-only action", () => {
    const callbacks = renderPanel(createModel([]));

    expect(screen.getByRole("status").textContent).toContain(
      "No recovery action is currently required"
    );
    expect(screen.queryByRole("button", { name: /Continue|Abandon/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(callbacks.onRefresh).toHaveBeenCalledTimes(1);
  });
});
