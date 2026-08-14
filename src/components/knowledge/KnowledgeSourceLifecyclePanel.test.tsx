import * as React from "react";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";

import {
  KnowledgeSourceLifecyclePanel,
  type KnowledgeSourceLifecyclePanelProps,
} from "@/components/knowledge/KnowledgeSourceLifecyclePanel";
import {
  createKnowledgeSourceLifecycleModel,
  type KnowledgeSourceLifecycleItem,
  type KnowledgeSourceLifecycleMissingItem,
  type KnowledgeSourceLifecycleReadyItem,
  type KnowledgeSourceRemovalConfirmation,
} from "@/knowledge/ui/sourceLifecycleModel";

/** Creates one externally controlled promise for in-flight command assertions. */
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

/** Creates one ready source row. */
function createReady(
  overrides: Partial<KnowledgeSourceLifecycleReadyItem> = {}
): KnowledgeSourceLifecycleReadyItem {
  return {
    sourceId: "source-ready",
    sourcePath: "Sources/Ready.md",
    custody: "user_managed",
    generatedPageCount: 2,
    retirementRef: "retirement-ready",
    retirementBlockers: [],
    status: "ready",
    actions: { canCheckAgain: false, canRemove: true },
    ...overrides,
  };
}

/** Creates one missing source row. */
function createMissing(
  overrides: Partial<KnowledgeSourceLifecycleMissingItem> = {}
): KnowledgeSourceLifecycleMissingItem {
  return {
    sourceId: "source-missing",
    sourcePath: "Sources/Missing.md",
    custody: "managed_copy",
    generatedPageCount: 1,
    retirementRef: "retirement-missing",
    retirementBlockers: [],
    status: "missing",
    issueReason: "source_missing",
    actions: { canCheckAgain: true, canRemove: true },
    ...overrides,
  };
}

/** Creates one immutable model around selected active sources. */
function createModel(sources: KnowledgeSourceLifecycleItem[] = [createReady(), createMissing()]) {
  return createKnowledgeSourceLifecycleModel({
    bundleId: "personal",
    runtimeRevision: 42,
    manifestRevision: 7,
    sources,
  });
}

/** Creates fresh command spies and renders the lifecycle panel. */
function renderPanel(
  model = createModel(),
  overrides: Partial<Pick<KnowledgeSourceLifecyclePanelProps, "onCheckAgain" | "onRemove">> = {}
) {
  const onCheckAgain = jest.fn(async () => undefined);
  const onRemove = jest.fn(async () => undefined);
  const rendered = render(
    <KnowledgeSourceLifecyclePanel
      model={model}
      onCheckAgain={overrides.onCheckAgain ?? onCheckAgain}
      onRemove={overrides.onRemove ?? onRemove}
    />
  );
  return { ...rendered, onCheckAgain, onRemove };
}

describe("KnowledgeSourceLifecyclePanel", () => {
  it("lists every active source and renders missing consequences without private refs", () => {
    const blocked = createReady({
      sourceId: "source-blocked",
      sourcePath: "Sources/Blocked.md",
      retirementRef: "private-retirement-ref",
      actions: { canCheckAgain: false, canRemove: false },
      retirementBlockers: ["bundle_review_pending", "active_transaction"],
    });
    const rendered = renderPanel(createModel([createReady(), createMissing(), blocked]));

    expect(rendered.getByRole("heading", { name: "Knowledge sources" })).toBeTruthy();
    expect(
      rendered.getByText(/Bundle personal · runtime revision 42 · manifest revision 7/)
    ).toBeTruthy();
    expect(rendered.getAllByRole("listitem")).toHaveLength(3);
    expect(rendered.getAllByText("Ready")).toHaveLength(2);
    expect(rendered.getByText("Missing")).toBeTruthy();
    expect(rendered.getAllByText("User managed")).toHaveLength(2);
    expect(rendered.getByText("Managed copy")).toBeTruthy();
    expect(rendered.getAllByText("2 generated pages")).toHaveLength(2);
    expect(rendered.getByText("1 generated page")).toBeTruthy();
    expect(rendered.getByText(/not present at its exact Vault path/)).toBeTruthy();
    expect(rendered.getByText(/Ingest and Review are stopped/)).toBeTruthy();
    expect(rendered.getByText(/Query citations are unavailable/)).toBeTruthy();
    expect(rendered.getByText(/Restore the file to this exact Vault path/)).toBeTruthy();
    expect(rendered.getByText(/Clear pending Activity, Review, or Recovery work/)).toBeTruthy();
    expect(rendered.queryByText("bundle_review_pending")).toBeNull();
    expect(rendered.queryByText("active_transaction")).toBeNull();
    expect(rendered.queryByText("private-retirement-ref")).toBeNull();

    const readyRow = rendered.getByText("Sources/Ready.md").closest("li");
    if (!readyRow) throw new Error("Expected ready source row");
    expect(within(readyRow).queryByRole("button", { name: /Check again/ })).toBeNull();

    const blockedRow = rendered.getByText("Sources/Blocked.md").closest("li");
    if (!blockedRow) throw new Error("Expected blocked source row");
    expect(within(blockedRow).queryByRole("button", { name: /Remove source/ })).toBeNull();
  });

  it("explains that an active reviewed Wiki revision must be resolved before removal", () => {
    const overlayBlocked = createReady({
      actions: { canCheckAgain: false, canRemove: false },
      retirementBlockers: ["forward_revision_overlay_active"],
    });

    const rendered = renderPanel(createModel([overlayBlocked]));

    expect(rendered.getByText(/owns an active reviewed Wiki revision/i).textContent).toContain(
      "Apply or supersede that revision"
    );
    expect(rendered.queryByText(/Clear pending Activity, Review, or Recovery work/)).toBeNull();
  });

  it("passes only sourceId plus a revocable signal and disables every concurrent action", async () => {
    const deferred = createDeferred<void>();
    const onCheckAgain = jest.fn<Promise<void>, [string, AbortSignal]>(() => deferred.promise);
    const rendered = renderPanel(createModel(), { onCheckAgain });

    fireEvent.click(rendered.getByRole("button", { name: "Check again source-missing" }));

    await waitFor(() => expect(onCheckAgain).toHaveBeenCalledTimes(1));
    const [sourceId, signal] = onCheckAgain.mock.calls[0];
    expect(sourceId).toBe("source-missing");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(
      rendered.getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled)
    ).toBe(true);
    const pendingRow = rendered.getByText("Sources/Missing.md").closest("li");
    expect(pendingRow?.getAttribute("aria-busy")).toBe("true");
    expect(rendered.getByRole("status").textContent).toContain("Checking source");

    rendered.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => deferred.resolve(undefined));
  });

  it("requires a second inline confirmation and forwards one frozen snapshot token", async () => {
    const deferred = createDeferred<void>();
    const onRemove = jest.fn<
      Promise<void>,
      [Readonly<KnowledgeSourceRemovalConfirmation>, AbortSignal]
    >(() => deferred.promise);
    const rendered = renderPanel(createModel([createMissing()]), { onRemove });
    const remove = rendered.getByRole("button", { name: "Remove source source-missing" });

    fireEvent.click(remove);

    expect(onRemove).not.toHaveBeenCalled();
    const dialog = rendered.getByRole("alertdialog", { name: "Remove this source?" });
    expect(dialog.textContent).toContain("future ingest, Review, and Query citations");
    expect(dialog.textContent).toContain("Generated Wiki files are not deleted");
    expect(dialog.textContent).toContain("Pending work or Recovery may block");

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep source source-missing" }));
    expect(rendered.queryByRole("alertdialog")).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(remove);
    fireEvent.click(rendered.getByRole("button", { name: "Confirm removal source-missing" }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
    const [confirmation, signal] = onRemove.mock.calls[0];
    expect(confirmation).toEqual({
      sourceId: "source-missing",
      sourcePath: "Sources/Missing.md",
      retirementRef: "retirement-missing",
      runtimeRevision: 42,
      manifestRevision: 7,
    });
    expect(Object.isFrozen(confirmation)).toBe(true);
    expect(signal.aborted).toBe(false);
    expect(rendered.queryByRole("alertdialog")).toBeNull();
    expect(
      rendered.getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled)
    ).toBe(true);

    await act(async () => deferred.resolve(undefined));
    await waitFor(() => expect(signal.aborted).toBe(false));
  });

  it.each([
    {
      name: "source path",
      model: createKnowledgeSourceLifecycleModel({
        bundleId: "personal",
        runtimeRevision: 42,
        manifestRevision: 7,
        sources: [createMissing({ sourcePath: "Sources/Moved.md" })],
      }),
    },
    {
      name: "retirement reference",
      model: createKnowledgeSourceLifecycleModel({
        bundleId: "personal",
        runtimeRevision: 42,
        manifestRevision: 7,
        sources: [createMissing({ retirementRef: "retirement-new" })],
      }),
    },
    {
      name: "Runtime revision",
      model: createKnowledgeSourceLifecycleModel({
        bundleId: "personal",
        runtimeRevision: 43,
        manifestRevision: 7,
        sources: [createMissing()],
      }),
    },
    {
      name: "manifest revision",
      model: createKnowledgeSourceLifecycleModel({
        bundleId: "personal",
        runtimeRevision: 42,
        manifestRevision: 8,
        sources: [createMissing()],
      }),
    },
  ])("invalidates confirmation after a $name change and never revives it", ({ model }) => {
    const initialModel = createModel([createMissing()]);
    const rendered = renderPanel(initialModel);

    fireEvent.click(rendered.getByRole("button", { name: "Remove source source-missing" }));
    expect(rendered.getByRole("alertdialog", { name: "Remove this source?" })).toBeTruthy();

    rendered.rerender(
      <KnowledgeSourceLifecyclePanel
        model={model}
        onCheckAgain={rendered.onCheckAgain}
        onRemove={rendered.onRemove}
      />
    );
    expect(rendered.queryByRole("alertdialog")).toBeNull();

    rendered.rerender(
      <KnowledgeSourceLifecyclePanel
        model={initialModel}
        onCheckAgain={rendered.onCheckAgain}
        onRemove={rendered.onRemove}
      />
    );
    expect(rendered.queryByRole("alertdialog")).toBeNull();
    expect(rendered.onRemove).not.toHaveBeenCalled();
  });

  it("does not revive a confirmation after removal becomes blocked and later available", async () => {
    const initialModel = createModel([createMissing()]);
    const blockedModel = createModel([
      createMissing({
        actions: { canCheckAgain: true, canRemove: false },
        retirementBlockers: ["bundle_review_pending"],
      }),
    ]);
    const rendered = renderPanel(initialModel);

    fireEvent.click(rendered.getByRole("button", { name: "Remove source source-missing" }));
    expect(rendered.getByRole("alertdialog", { name: "Remove this source?" })).toBeTruthy();

    rendered.rerender(
      <KnowledgeSourceLifecyclePanel
        model={blockedModel}
        onCheckAgain={rendered.onCheckAgain}
        onRemove={rendered.onRemove}
      />
    );
    expect(rendered.queryByRole("alertdialog")).toBeNull();

    rendered.rerender(
      <KnowledgeSourceLifecyclePanel
        model={initialModel}
        onCheckAgain={rendered.onCheckAgain}
        onRemove={rendered.onRemove}
      />
    );
    expect(rendered.queryByRole("alertdialog")).toBeNull();
    expect(rendered.onRemove).not.toHaveBeenCalled();

    fireEvent.click(rendered.getByRole("button", { name: "Remove source source-missing" }));
    fireEvent.click(rendered.getByRole("button", { name: "Confirm removal source-missing" }));
    await waitFor(() => expect(rendered.onRemove).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        rendered.getAllByRole("button").some((button) => (button as HTMLButtonElement).disabled)
      ).toBe(false)
    );
  });

  it("sanitizes rejected callbacks and never echoes their path-bearing errors", async () => {
    const onCheckAgain = jest.fn(async () => {
      throw new Error("D:\\private\\vault\\Sources\\Missing.md could not be read");
    });
    const rendered = renderPanel(createModel([createMissing()]), { onCheckAgain });

    fireEvent.click(rendered.getByRole("button", { name: "Check again source-missing" }));

    await waitFor(() =>
      expect(
        rendered.getByText("The source could not be checked. No source state was assumed.")
      ).toBeTruthy()
    );
    const feedback = rendered
      .getByText("The source could not be checked. No source state was assumed.")
      .closest('[role="alert"]');
    expect(feedback).toBeTruthy();
    expect(feedback?.textContent).not.toContain("private");
    expect(feedback?.textContent).not.toContain("Missing.md");
  });

  it("renders an empty active-source snapshot without inventing actions", () => {
    const rendered = renderPanel(createModel([]));

    expect(rendered.getByRole("status").textContent).toContain("No active sources");
    expect(rendered.queryByRole("list")).toBeNull();
    expect(rendered.queryByRole("button")).toBeNull();
  });
});
