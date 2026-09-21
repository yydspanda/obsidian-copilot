import * as React from "react";
import { fireEvent, render } from "@testing-library/react";

import {
  KnowledgeAddMaterialForm,
  type KnowledgeAddMaterialFormProps,
} from "@/components/knowledge/KnowledgeAddMaterialForm";
import meta, {
  Adding,
  ChooseMaterial,
  Conflict,
  NoMatches,
  QueueUnknown,
  RegisterPaused,
  SearchResults,
  SnapshotNeedsConsent,
  SnapshotReadyRunning,
} from "@/components/knowledge/KnowledgeAddMaterialForm.stories";

function props(
  overrides: Partial<KnowledgeAddMaterialFormProps> = {}
): KnowledgeAddMaterialFormProps {
  return { ...meta.args, ...overrides };
}

describe("KnowledgeAddMaterialForm", () => {
  describe("KnowledgeAddMaterialForm()", () => {
    it("forwards a chosen full path without authorizing an addition — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const onSelect = jest.fn();
      const onAdd = jest.fn();
      const view = render(<KnowledgeAddMaterialForm {...props({ onSelect, onAdd })} />);

      fireEvent.click(view.getByRole("radio", { name: /Interview observations.md/ }));

      expect(onSelect).toHaveBeenCalledWith("Knowledge/Sources/Interview observations.md");
      expect(onAdd).not.toHaveBeenCalled();
    });

    it("forwards search text without treating arbitrary text as an authorized path — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const onQueryChange = jest.fn();
      const onSelect = jest.fn();
      const onAdd = jest.fn();
      const view = render(
        <KnowledgeAddMaterialForm {...props({ onQueryChange, onSelect, onAdd })} />
      );

      fireEvent.change(view.getByRole("searchbox"), {
        target: { value: "Private/not-in-choices.md" },
      });

      expect(onQueryChange).toHaveBeenCalledWith("Private/not-in-choices.md");
      expect(onSelect).not.toHaveBeenCalled();
      expect(onAdd).not.toHaveBeenCalled();
    });

    it("forwards snapshot consent separately from the explicit Add command — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const onSnapshotConfirmChange = jest.fn();
      const onAdd = jest.fn();
      const view = render(
        <KnowledgeAddMaterialForm
          {...props({ ...SnapshotNeedsConsent.args, onSnapshotConfirmChange, onAdd })}
        />
      );

      fireEvent.click(view.getByRole("checkbox"));

      expect(onSnapshotConfirmChange).toHaveBeenCalledWith(true);
      expect(onAdd).not.toHaveBeenCalled();
      expect(view.getByText(/later edits to the original do not automatically sync/)).toBeTruthy();
    });

    it.each([
      ["register", RegisterPaused.args],
      ["confirmed snapshot", SnapshotReadyRunning.args],
    ])(
      "forwards explicit Add for a ready %s selection — https://github.com/yydspanda/obsidian-copilot/issues/13",
      (_name, args) => {
        const onAdd = jest.fn();
        const view = render(<KnowledgeAddMaterialForm {...props({ ...args, onAdd })} />);

        fireEvent.submit(view.getByRole("form", { name: "Choose material" }));

        expect(onAdd).toHaveBeenCalledTimes(1);
      }
    );

    it.each([
      ["no selection", ChooseMaterial.args],
      ["unconfirmed snapshot", SnapshotNeedsConsent.args],
      ["in-flight addition", Adding.args],
    ])(
      "refuses submission with %s even if a form event is dispatched — https://github.com/yydspanda/obsidian-copilot/issues/13",
      (_name, args) => {
        const onAdd = jest.fn();
        const view = render(<KnowledgeAddMaterialForm {...props({ ...args, onAdd })} />);

        fireEvent.submit(view.getByRole("form", { name: "Choose material" }));

        expect(onAdd).not.toHaveBeenCalled();
      }
    );

    it("keeps Cancel available during addition without invoking Add — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const onCancel = jest.fn();
      const onAdd = jest.fn();
      const view = render(
        <KnowledgeAddMaterialForm {...props({ ...Adding.args, onCancel, onAdd })} />
      );

      fireEvent.click(view.getByRole("button", { name: "Cancel" }));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onAdd).not.toHaveBeenCalled();
    });

    it.each([
      ["chooser", ChooseMaterial, 3, false],
      ["filtered search", SearchResults, 2, false],
      ["empty search", NoMatches, 0, false],
      ["registered source", RegisterPaused, 3, true],
      ["snapshot without consent", SnapshotNeedsConsent, 3, false],
      ["snapshot with consent and running queue", SnapshotReadyRunning, 3, true],
      ["adding", Adding, 3, false],
      ["unknown queue", QueueUnknown, 3, true],
      ["conflicting destination", Conflict, 3, false],
    ] as const)(
      "renders the real %s gallery args with visible authority boundaries — https://github.com/yydspanda/obsidian-copilot/issues/13",
      (_name, story, count, canAdd) => {
        const state = props(story.args);
        const view = render(<KnowledgeAddMaterialForm {...state} />);

        expect(view.queryAllByRole("radio")).toHaveLength(count);
        expect(
          view
            .getByRole("button", { name: state.busy ? "Adding…" : "Add" })
            .hasAttribute("disabled")
        ).toBe(!canAdd);
        expect(view.getByText("Wiki changes still require Review and Apply.")).toBeTruthy();
        expect(
          view.getByText(
            "Processing can use your configured model and incur charges when activity is running."
          )
        ).toBeTruthy();
        if (state.selection) {
          expect(view.getAllByText(state.selection.sourcePath).length).toBeGreaterThan(0);
          expect(view.getAllByText(state.selection.destinationPath).length).toBeGreaterThan(0);
        }
        if (count === 0) expect(view.getByText("No matching materials.")).toBeTruthy();
        if (state.error) expect(view.getByRole("alert").textContent).toBe(state.error);
        if (state.queueState === "unknown") {
          expect(view.getByText(/Activity status is unavailable/).textContent).toContain(
            "does not resume paused activity"
          );
        }
      }
    );
  });
});
