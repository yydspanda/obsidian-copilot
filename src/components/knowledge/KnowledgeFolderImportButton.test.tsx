import * as React from "react";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";

import { KnowledgeFolderImportButton } from "@/components/knowledge/KnowledgeFolderImportButton";
import type {
  KnowledgeFolderImportPort,
  KnowledgeFolderImportReceipt,
} from "@/knowledge/capture/KnowledgeFolderImportPort";

/** Creates one path-free aggregate receipt for the requested terminal status. */
function createReceipt(
  status: KnowledgeFolderImportReceipt["status"] = "completed"
): KnowledgeFolderImportReceipt {
  return {
    status,
    bundleId: "personal",
    discoveredFiles: 6,
    eligibleFiles: 5,
    importedFiles: 3,
    reusedFiles: 1,
    skippedFiles: 1,
    conflictFiles: status === "partial" ? 1 : 0,
    failedFiles: status === "partial" ? 1 : 0,
    importedBytes: 128,
  };
}

/** Creates one import port around a Jest command spy. */
function createPort(
  implementation: KnowledgeFolderImportPort["importFolder"] = jest
    .fn()
    .mockResolvedValue(createReceipt())
): KnowledgeFolderImportPort & { importFolder: jest.Mock } {
  return { importFolder: implementation as jest.Mock };
}

/** Returns the hidden folder input created beside the rendered button. */
function getFolderInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Expected a folder input");
  return input;
}

/** Supplies a deterministic browser selection to jsdom's read-only files property. */
function selectFiles(input: HTMLInputElement, files: readonly File[]): void {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  fireEvent.change(input);
}

describe("KnowledgeFolderImportButton", () => {
  it("creates a folder-only picker in the button owner document", () => {
    const host = render(<div />);
    const mainDocument = host.container.doc;
    const iframe = mainDocument.createElement("iframe");
    mainDocument.body.appendChild(iframe);
    const popoutDocument = iframe.contentDocument;
    if (!popoutDocument) throw new Error("Expected an iframe document");
    const container = popoutDocument.createElement("div");
    popoutDocument.body.appendChild(container);
    const rendered = render(<KnowledgeFolderImportButton port={createPort()} />, { container });
    const button = within(container).getByRole("button", { name: "Import folder" });
    Object.defineProperty(button, "doc", { configurable: true, value: popoutDocument });

    fireEvent.click(button);

    const input = getFolderInput(container);
    expect(input.ownerDocument).toBe(popoutDocument);
    expect(input.multiple).toBe(true);
    expect(input.hidden).toBe(true);
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    expect(input.hasAttribute("directory")).toBe(true);

    rendered.unmount();
    iframe.remove();
    host.unmount();
  });

  it("treats picker cancellation as a no-op", () => {
    const port = createPort();
    const rendered = render(<KnowledgeFolderImportButton port={port} />);
    fireEvent.click(rendered.getByRole("button", { name: "Import folder" }));
    const input = getFolderInput(rendered.container);

    fireEvent(input, new Event("cancel"));

    expect(port.importFolder).not.toHaveBeenCalled();
    expect(rendered.container.querySelector('input[type="file"]')).toBeNull();
    expect(rendered.queryByRole("status")).toBeNull();
    expect(rendered.queryByRole("alert")).toBeNull();
  });

  it("passes the exact selected Files and renders only aggregate success", async () => {
    const port = createPort();
    const rendered = render(<KnowledgeFolderImportButton port={port} />);
    const file = new File(["private"], "private-name.md", { type: "text/markdown" });
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      value: "my_idea/private-name.md",
    });

    fireEvent.click(rendered.getByRole("button", { name: "Import folder" }));
    selectFiles(getFolderInput(rendered.container), [file]);

    await waitFor(() => expect(port.importFolder).toHaveBeenCalledTimes(1));
    const [request, signal] = port.importFolder.mock.calls[0] as [
      { files: readonly File[] },
      AbortSignal,
    ];
    expect(request.files).toEqual([file]);
    expect(signal.aborted).toBe(false);
    const status = await rendered.findByRole("status");
    expect(status.textContent).toBe(
      "Folder import completed. 3 imported · 1 reused · 1 skipped · 0 conflicts · 0 failed."
    );
    expect(status.textContent).not.toContain("private-name.md");
    expect(status.textContent).not.toContain("my_idea");
  });

  it("renders a path-free partial aggregate as status", async () => {
    const port = createPort(jest.fn().mockResolvedValue(createReceipt("partial")));
    const rendered = render(<KnowledgeFolderImportButton port={port} />);

    fireEvent.click(rendered.getByRole("button", { name: "Import folder" }));
    selectFiles(getFolderInput(rendered.container), [new File(["text"], "confidential.txt")]);

    const status = await rendered.findByRole("status");
    expect(status.textContent).toBe(
      "Folder import partially completed. 3 imported · 1 reused · 1 skipped · 1 conflicts · 1 failed."
    );
    expect(status.textContent).not.toContain("confidential.txt");
  });

  it("sanitizes rejected errors instead of echoing paths", async () => {
    const port = createPort(
      jest.fn().mockRejectedValue(new Error("D:\\my_idea\\private-name.md could not be read"))
    );
    const rendered = render(<KnowledgeFolderImportButton port={port} />);

    fireEvent.click(rendered.getByRole("button", { name: "Import folder" }));
    selectFiles(getFolderInput(rendered.container), [new File(["text"], "private-name.md")]);

    const alert = await rendered.findByRole("alert");
    expect(alert.textContent).toBe("Folder import could not be completed.");
    expect(alert.textContent).not.toContain("my_idea");
    expect(alert.textContent).not.toContain("private-name.md");
  });

  it("disables the control in flight and aborts the exact operation on unmount", async () => {
    let settle: ((receipt: KnowledgeFolderImportReceipt) => void) | undefined;
    const pending = new Promise<KnowledgeFolderImportReceipt>((resolve) => {
      settle = resolve;
    });
    const port = createPort(jest.fn().mockReturnValue(pending));
    const rendered = render(<KnowledgeFolderImportButton port={port} />);

    fireEvent.click(rendered.getByRole("button", { name: "Import folder" }));
    selectFiles(getFolderInput(rendered.container), [new File(["text"], "note.md")]);

    await waitFor(() => expect(port.importFolder).toHaveBeenCalledTimes(1));
    const signal = port.importFolder.mock.calls[0]?.[1] as AbortSignal;
    expect(
      rendered.getByRole("button", { name: "Importing folder…" }).hasAttribute("disabled")
    ).toBe(true);
    expect(signal.aborted).toBe(false);

    rendered.unmount();

    expect(signal.aborted).toBe(true);
    await act(async () => settle?.(createReceipt()));
  });
});
