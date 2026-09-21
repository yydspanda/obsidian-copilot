import * as React from "react";
import { act, fireEvent, render } from "@testing-library/react";

import { KnowledgeAddMaterialButton } from "@/components/knowledge/KnowledgeAddMaterialButton";
import {
  KnowledgeStudioMaterialError,
  type KnowledgeStudioMaterialPort,
  type KnowledgeStudioMaterialReceipt,
  type KnowledgeStudioMaterialSelection,
  type KnowledgeStudioMaterialSession,
} from "@/knowledge/capture/KnowledgeStudioMaterialPort";

const session: KnowledgeStudioMaterialSession = {
  bundleId: "research",
  sourceRoot: "Sources",
  choices: [
    { path: "Sources/interview.md", size: 240 },
    { path: "Reading/paper.pdf", size: 3200 },
  ],
};
const registered: KnowledgeStudioMaterialSelection = {
  bundleId: "research",
  sourcePath: "Sources/interview.md",
  destinationPath: "Sources/interview.md",
  mode: "register",
};
const snapshot: KnowledgeStudioMaterialSelection = {
  bundleId: "research",
  sourcePath: "Reading/paper.pdf",
  destinationPath: "Sources/imports/paper.pdf",
  mode: "snapshot",
};

function createPort() {
  return {
    prepare: jest.fn<KnowledgeStudioMaterialSession | null, [string]>(() => session),
    select: jest.fn((_session, path) => (path === registered.sourcePath ? registered : snapshot)),
    add: jest.fn<
      Promise<KnowledgeStudioMaterialReceipt>,
      [KnowledgeStudioMaterialSelection, AbortSignal]
    >(async (selection) => ({ ...selection, status: "added" })),
  } satisfies KnowledgeStudioMaterialPort;
}

function pendingReceipt() {
  let resolve!: (receipt: KnowledgeStudioMaterialReceipt) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<KnowledgeStudioMaterialReceipt>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function mount(port = createPort()) {
  const onReceipt = jest.fn();
  const props = { port, bundleId: "research", queueState: "paused" as const, onReceipt };
  const view = render(<KnowledgeAddMaterialButton {...props} />);
  const open = () => fireEvent.click(view.getByRole("button", { name: "Add materials" }));
  const choose = (name = /Sources\/interview.md/) =>
    fireEvent.click(view.getByRole("radio", { name }));
  return { ...view, port, onReceipt, props, open, choose };
}

describe("KnowledgeAddMaterialButton", () => {
  describe("KnowledgeAddMaterialButton()", () => {
    it("registers only the chosen source after explicit Add and publishes its receipt — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const port = createPort();
      const onReceipt = jest.fn();
      const view = render(
        <KnowledgeAddMaterialButton
          port={port}
          bundleId="research"
          queueState="paused"
          onReceipt={onReceipt}
        />
      );

      fireEvent.click(view.getByRole("button", { name: "Add materials" }));
      expect(port.prepare).toHaveBeenCalledWith("research");
      fireEvent.click(view.getByRole("radio", { name: /Sources\/interview.md/ }));
      expect(port.select).toHaveBeenCalledWith(session, registered.sourcePath);
      expect(port.add).not.toHaveBeenCalled();
      expect(
        view.getByText(
          "Activity is currently paused. Adding materials does not resume paused activity."
        )
      ).toBeTruthy();

      await act(async () => fireEvent.click(view.getByRole("button", { name: "Add" })));

      expect(port.add).toHaveBeenCalledTimes(1);
      expect(port.add).toHaveBeenCalledWith(registered, expect.any(AbortSignal));
      expect(onReceipt).toHaveBeenCalledWith({ ...registered, status: "added" });
      expect(view.queryByRole("searchbox")).toBeNull();
    });

    it("requires snapshot consent as well as Add before copying an external-root file — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const port = createPort();
      const view = render(
        <KnowledgeAddMaterialButton
          port={port}
          bundleId="research"
          queueState="running"
          onReceipt={jest.fn()}
        />
      );

      fireEvent.click(view.getByRole("button", { name: "Add materials" }));
      fireEvent.click(view.getByRole("radio", { name: /Reading\/paper.pdf/ }));
      expect(view.getByText(snapshot.destinationPath)).toBeTruthy();
      expect(view.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
      expect(
        view.getByText(
          "Activity is currently running. Adding material may trigger paid model analysis."
        )
      ).toBeTruthy();
      fireEvent.click(view.getByRole("checkbox"));
      expect(port.add).not.toHaveBeenCalled();

      await act(async () => fireEvent.click(view.getByRole("button", { name: "Add" })));

      expect(port.add).toHaveBeenCalledWith(snapshot, expect.any(AbortSignal));
    });

    it("starts at most one addition when Add is activated repeatedly in the same turn — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const pending = pendingReceipt();
      const port = createPort();
      port.add.mockReturnValue(pending.promise);
      const view = render(
        <KnowledgeAddMaterialButton
          port={port}
          bundleId="research"
          queueState="paused"
          onReceipt={jest.fn()}
        />
      );
      fireEvent.click(view.getByRole("button", { name: "Add materials" }));
      fireEvent.click(view.getByRole("radio", { name: /Sources\/interview.md/ }));
      const button = view.getByRole("button", { name: "Add" });

      act(() => {
        button.click();
        button.click();
      });

      expect(port.add).toHaveBeenCalledTimes(1);
      expect(view.getByRole("button", { name: "Adding…" }).hasAttribute("disabled")).toBe(true);
      await act(async () => pending.resolve({ ...registered, status: "added" }));
    });

    it("publishes an already-added receipt without claiming a second registration — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const port = createPort();
      port.add.mockResolvedValue({ ...registered, status: "already_added" });
      const view = mount(port);
      view.open();
      view.choose();

      await act(async () => fireEvent.click(view.getByRole("button", { name: "Add" })));

      expect(view.onReceipt).toHaveBeenCalledWith({ ...registered, status: "already_added" });
    });

    it("filters file paths without selecting or adding a material — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const view = mount();
      view.open();

      fireEvent.change(view.getByRole("searchbox"), { target: { value: " READING/ " } });

      expect(view.getAllByRole("radio")).toHaveLength(1);
      expect(view.getByRole("radio", { name: /Reading\/paper.pdf/ })).toBeTruthy();
      expect(view.port.select).not.toHaveBeenCalled();
      expect(view.port.add).not.toHaveBeenCalled();
    });

    it("cancels the chooser with no addition and reopens with a fresh selection — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const view = mount();
      view.open();
      view.choose();
      fireEvent.change(view.getByRole("searchbox"), { target: { value: "interview" } });

      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      expect(view.queryByRole("searchbox")).toBeNull();
      view.open();

      expect((view.getByRole("searchbox") as HTMLInputElement).value).toBe("");
      expect(
        view.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)
      ).toBe(true);
      expect(view.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
      expect(view.port.add).not.toHaveBeenCalled();
    });

    it("requires fresh snapshot consent after changing the chosen material — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const view = mount();
      view.open();
      view.choose(/Reading\/paper.pdf/);
      fireEvent.click(view.getByRole("checkbox"));
      expect(view.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(false);

      view.choose();
      view.choose(/Reading\/paper.pdf/);

      expect((view.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
      expect(view.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
    });

    it("shows a fixed unavailable explanation when no released chooser exists — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const port = createPort();
      port.prepare.mockReturnValue(null);
      const view = mount(port);

      view.open();

      expect(view.getByRole("alert").textContent).toBe(
        "Adding materials is unavailable. Refresh Knowledge Studio and try again."
      );
      expect(view.queryByRole("searchbox")).toBeNull();
      expect(port.add).not.toHaveBeenCalled();
    });

    it.each(["prepare", "select", "add"] as const)(
      "sanitizes unexpected %s failures without exposing rejected paths or secrets — https://github.com/yydspanda/obsidian-copilot/issues/13",
      async (phase) => {
        const view = mount();
        const error = new Error("Private/rejected-note.md sk-private-canary");
        if (phase === "add") view.port.add.mockRejectedValue(error);
        else
          view.port[phase].mockImplementation(() => {
            throw error;
          });
        view.open();
        if (phase !== "prepare") view.choose();
        if (phase === "add") {
          await act(async () => fireEvent.click(view.getByRole("button", { name: "Add" })));
        }

        expect(view.getByRole("alert").textContent).toBe(
          "The material could not be added. Refresh Knowledge Studio and try again."
        );
        expect(view.container.textContent).not.toContain("sk-private-canary");
        expect(view.container.textContent).not.toContain("rejected-note");
        expect(view.onReceipt).not.toHaveBeenCalled();
      }
    );

    it.each([
      ["unavailable", "Adding materials is unavailable. Refresh Knowledge Studio and try again."],
      ["stale_selection", "This selection has expired. Close and reopen Add materials."],
      ["source_changed", "The selected file has changed. Close and reopen Add materials."],
      ["source_too_large", "The selected file exceeds the material size limit."],
      ["source_not_allowed", "This file cannot be added as a Knowledge material."],
      ["conflict", "The destination is already occupied. No file was overwritten."],
      ["add_failed", "The material could not be added. Refresh Knowledge Studio and try again."],
    ] as const)(
      "maps %s to fixed actionable copy after an add failure — https://github.com/yydspanda/obsidian-copilot/issues/13",
      async (code, message) => {
        const view = mount();
        view.port.add.mockRejectedValue(new KnowledgeStudioMaterialError(code));
        view.open();
        view.choose();

        await act(async () => fireEvent.click(view.getByRole("button", { name: "Add" })));

        expect(view.getByRole("alert").textContent).toBe(message);
        expect(view.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(false);
        expect(view.onReceipt).not.toHaveBeenCalled();
      }
    );

    it("aborts on unmount but still delivers a successful committed receipt to the owner — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const pending = pendingReceipt();
      const view = mount();
      view.port.add.mockReturnValue(pending.promise);
      view.open();
      view.choose();
      fireEvent.click(view.getByRole("button", { name: "Add" }));
      const signal = view.port.add.mock.calls[0][1];

      view.unmount();
      expect(signal.aborted).toBe(true);
      await act(async () => pending.resolve({ ...registered, status: "added" }));

      expect(view.onReceipt).toHaveBeenCalledWith({ ...registered, status: "added" });
    });

    it("discards the old chooser on bundle change and does not close the new chooser for a late receipt — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const pending = pendingReceipt();
      const view = mount();
      view.port.add.mockReturnValue(pending.promise);
      view.open();
      view.choose();
      fireEvent.click(view.getByRole("button", { name: "Add" }));
      const signal = view.port.add.mock.calls[0][1];

      view.rerender(<KnowledgeAddMaterialButton {...view.props} bundleId="second-bundle" />);
      expect(signal.aborted).toBe(true);
      expect(view.queryByRole("searchbox")).toBeNull();
      view.port.prepare.mockReturnValue({ ...session, bundleId: "second-bundle" });
      view.open();
      await act(async () => pending.resolve({ ...registered, status: "added" }));

      expect(view.getByRole("searchbox")).toBeTruthy();
      expect(view.onReceipt).toHaveBeenCalledWith({ ...registered, status: "added" });
    });

    it.each(["port", "disabled"] as const)(
      "closes and aborts the old chooser when %s changes — https://github.com/yydspanda/obsidian-copilot/issues/13",
      (change) => {
        const pending = pendingReceipt();
        const view = mount();
        view.port.add.mockReturnValue(pending.promise);
        view.open();
        view.choose();
        fireEvent.click(view.getByRole("button", { name: "Add" }));
        const signal = view.port.add.mock.calls[0][1];

        view.rerender(
          <KnowledgeAddMaterialButton
            {...view.props}
            {...(change === "port" ? { port: createPort() } : { disabled: true })}
          />
        );

        expect(signal.aborted).toBe(true);
        expect(view.queryByRole("searchbox")).toBeNull();
        expect(view.port.add).toHaveBeenCalledTimes(1);
      }
    );

    it("cancels an in-flight addition without displaying a later rejection in a reopened chooser — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const pending = pendingReceipt();
      const view = mount();
      view.port.add.mockReturnValue(pending.promise);
      view.open();
      view.choose();
      fireEvent.click(view.getByRole("button", { name: "Add" }));
      const signal = view.port.add.mock.calls[0][1];

      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      expect(signal.aborted).toBe(true);
      view.open();
      await act(async () => pending.reject(new Error("private stale failure")));

      expect(view.queryByRole("alert")).toBeNull();
      expect(view.getByRole("searchbox")).toBeTruthy();
      expect(view.onReceipt).not.toHaveBeenCalled();
    });

    it("does not prepare a chooser while the parent disables material addition — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const view = mount();
      view.rerender(<KnowledgeAddMaterialButton {...view.props} disabled />);

      view.open();

      expect(view.port.prepare).not.toHaveBeenCalled();
      expect(view.queryByRole("searchbox")).toBeNull();
    });
  });
});
