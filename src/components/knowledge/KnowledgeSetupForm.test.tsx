import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KnowledgeSetupForm } from "@/components/knowledge/KnowledgeSetupForm";
import type { KnowledgeSetupPort } from "@/knowledge/setup/KnowledgeSetupPort";

function createPort() {
  return {
    getOptions: jest.fn(() => ({
      availability: "available" as const,
      projects: [{ id: "project-1", name: "Reading" }],
      models: [{ configuredModelId: "pro-1", label: "DeepSeek Pro" }],
      folders: ["chapters"],
    })),
    configure: jest.fn(async () => ({
      projectId: "project-1",
      bundleId: "reading",
      sourceRoot: "Sources/Knowledge",
      wikiRoot: "Wiki/Knowledge",
      schemaRef: "Knowledge/rules.md",
    })),
  };
}

function selectModel(): void {
  fireEvent.change(screen.getByLabelText("Knowledge model"), { target: { value: "pro-1" } });
}

describe("KnowledgeSetupForm", () => {
  describe("KnowledgeSetupForm()", () => {
    it("publishes a committed setup receipt after its own refresh unmounts the form — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const base = createPort();
      let resolve!: (receipt: Awaited<ReturnType<KnowledgeSetupPort["configure"]>>) => void;
      const port = {
        ...base,
        configure: jest.fn(
          () =>
            new Promise<Awaited<ReturnType<KnowledgeSetupPort["configure"]>>>((done) => {
              resolve = done;
            })
        ),
      };
      const onConfigured = jest.fn();
      const view = render(<KnowledgeSetupForm port={port} onConfigured={onConfigured} />);
      selectModel();
      fireEvent.click(screen.getByRole("button", { name: "Create Knowledge setup" }));
      view.unmount();
      await act(async () => {
        resolve(await base.configure());
      });
      expect(onConfigured).toHaveBeenCalledTimes(1);
    });
    it("shows local setup fields without writing until explicitly confirmed — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const port = createPort();
      render(<KnowledgeSetupForm port={port} />);
      expect(screen.getByLabelText("Copilot Project")).toBeTruthy();
      expect(screen.getByLabelText("Knowledge model")).toBeTruthy();
      expect(screen.getByLabelText("Source folder")).toBeTruthy();
      expect(screen.getByText(/does not import materials or call a model/)).toBeTruthy();
      expect(port.configure).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Create Knowledge setup" }).hasAttribute("disabled")
      ).toBe(true);
    });

    it("submits the exact model and edited locations with visible rules after confirmation — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const port = createPort();
      const onConfigured = jest.fn();
      render(<KnowledgeSetupForm port={port} onConfigured={onConfigured} />);
      selectModel();
      fireEvent.change(screen.getByLabelText("Source folder"), { target: { value: "chapters" } });
      fireEvent.change(screen.getByLabelText("Rules content"), {
        target: { value: "Use only source evidence." },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create Knowledge setup" }));
      await waitFor(() => expect(onConfigured).toHaveBeenCalledTimes(1));
      expect(port.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          configuredModelId: "pro-1",
          sourceRoot: "chapters",
          wikiRoot: "Wiki/Knowledge",
          schemaRef: "Knowledge/rules.md",
          rules: { kind: "create", content: "Use only source evidence." },
        }),
        expect.any(AbortSignal)
      );
      expect(screen.getByRole("status").textContent).toContain("Setup saved");
    });

    it("reuses an existing rules file only after that mode is selected — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const port = createPort();
      render(<KnowledgeSetupForm port={port} />);
      selectModel();
      fireEvent.click(screen.getByLabelText("Use existing rules file without changing it"));
      expect(screen.queryByLabelText("Rules content")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Create Knowledge setup" }));
      await waitFor(() => expect(port.configure).toHaveBeenCalledTimes(1));
      expect(port.configure.mock.calls[0]).toEqual([
        expect.objectContaining({ rules: { kind: "reuse" } }),
        expect.any(AbortSignal),
      ]);
    });

    it("blocks repeated confirmation while saving and disables fields — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const base = createPort();
      let resolve!: (value: Awaited<ReturnType<KnowledgeSetupPort["configure"]>>) => void;
      const port = {
        ...base,
        configure: jest.fn(
          () =>
            new Promise<Awaited<ReturnType<KnowledgeSetupPort["configure"]>>>((done) => {
              resolve = done;
            })
        ),
      };
      render(<KnowledgeSetupForm port={port} />);
      selectModel();
      fireEvent.click(screen.getByRole("button", { name: "Create Knowledge setup" }));
      fireEvent.click(screen.getByRole("button", { name: "Saving setup…" }));
      expect(port.configure).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Source folder").hasAttribute("disabled")).toBe(true);
      await act(async () => resolve(await base.configure()));
    });

    it("shows safe failure feedback without echoing provider or filesystem errors — https://github.com/yydspanda/obsidian-copilot/issues/13", async () => {
      const port = {
        ...createPort(),
        configure: jest.fn().mockRejectedValue(new Error("secret C:/private-vault")),
      };
      render(<KnowledgeSetupForm port={port} />);
      selectModel();
      fireEvent.click(screen.getByRole("button", { name: "Create Knowledge setup" }));
      const error = await screen.findByRole("alert");
      expect(error.textContent).toContain("Setup could not be completed");
      expect(error.textContent).not.toContain("secret");
      expect(error.textContent).not.toContain("private-vault");
    });

    it("cancels pending setup when the form unmounts — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const configure = jest.fn((_request, _signal) => new Promise<never>(() => {}));
      const port = { ...createPort(), configure };
      const view = render(<KnowledgeSetupForm port={port} />);
      selectModel();
      fireEvent.click(screen.getByRole("button", { name: "Create Knowledge setup" }));
      const signal = configure.mock.calls[0][1] as AbortSignal;
      view.unmount();
      expect(signal.aborted).toBe(true);
    });

    it("explains missing project and model prerequisites without offering a write — https://github.com/yydspanda/obsidian-copilot/issues/13", () => {
      const port = {
        ...createPort(),
        getOptions: () => ({ availability: "available" as const, projects: [], models: [] }),
      };
      render(<KnowledgeSetupForm port={port} />);
      expect(screen.getByText(/Create a Copilot Project first/)).toBeTruthy();
      expect(screen.getByText(/Add an official DeepSeek model/)).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Create Knowledge setup" }).hasAttribute("disabled")
      ).toBe(true);
      expect(port.configure).not.toHaveBeenCalled();
    });
  });
});
