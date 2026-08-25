import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { createEvent, fireEvent, render, waitFor } from "@testing-library/react";
import type { App, TFile } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";
import React, { useEffect, useRef } from "react";

const TestTFile = ObsidianTFile as unknown as new (sourcePath: string) => TFile;

/** Minimal harness that installs the production drop listeners on one element. */
function DropHarness({
  app,
  setContextNotes,
  onKnowledgeFileDrop,
}: {
  app: App;
  setContextNotes: jest.Mock;
  onKnowledgeFileDrop?: jest.Mock;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  useChatFileDrop({
    app,
    contextNotes: [],
    setContextNotes,
    selectedImages: [],
    onAddImage: jest.fn(),
    onKnowledgeFileDrop,
    containerRef,
  });
  return <div data-testid="drop-target" ref={containerRef} />;
}

/** Creates one Obsidian URI DataTransfer projection for a Vault nav drag. */
function createUriDataTransfer(sourcePath: string, vaultName = "Test"): DataTransfer {
  const item = {
    kind: "string",
    getAsString: (callback: (value: string) => void) =>
      callback(
        `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(sourcePath)}`
      ),
  } as DataTransferItem;
  return {
    items: [item],
    types: ["text/plain"],
    dropEffect: "copy",
  } as unknown as DataTransfer;
}

/** Creates a minimal App whose Vault resolves exactly one file. */
function createApp(file: TFile): App {
  return {
    vault: {
      getAbstractFileByPath: jest.fn((sourcePath: string) =>
        sourcePath === file.path ? file : null
      ),
      getName: jest.fn(() => "Test"),
    },
  } as unknown as App;
}

interface FakeDropItem {
  kind: "string" | "file";
}

/** Creates the minimal DataTransfer projection used by the overlay regression test. */
function createOverlayDataTransfer(items: FakeDropItem[]): DataTransfer {
  return {
    types: [],
    dropEffect: "",
    items: items.map((item) => ({ kind: item.kind })),
  } as unknown as DataTransfer;
}

/** Dispatches one cancellable drag event with an attached DataTransfer projection. */
function dispatchOverlayDrag(
  type: "dragOver" | "drop",
  target: HTMLElement,
  items: FakeDropItem[]
): void {
  const event = createEvent[type](target, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: createOverlayDataTransfer(items) });
  fireEvent(target, event);
}

/** Reproduces an inner drop zone that owns persistence and stops bubble propagation. */
function OverlayHarness({ app }: { app: App }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerZoneRef = useRef<HTMLDivElement>(null);
  const { isDragActive } = useChatFileDrop({
    app,
    contextNotes: [],
    setContextNotes: jest.fn(),
    selectedImages: [],
    onAddImage: jest.fn(),
    containerRef,
  });

  useEffect(() => {
    const innerZone = innerZoneRef.current;
    if (!innerZone) return;
    const stopBubble = (event: Event): void => event.stopPropagation();
    innerZone.addEventListener("drop", stopBubble);
    return () => innerZone.removeEventListener("drop", stopBubble);
  }, []);

  return (
    <div ref={containerRef}>
      <div data-testid="overlay">{isDragActive ? "active" : "idle"}</div>
      <div ref={innerZoneRef} data-copilot-drop-zone="" data-testid="inner-zone" />
    </div>
  );
}

describe("useChatFileDrop", () => {
  it("clears the overlay when an inner drop zone stops bubble propagation", () => {
    const { getByTestId } = render(<OverlayHarness app={{} as App} />);
    const overlay = getByTestId("overlay");

    dispatchOverlayDrag("dragOver", overlay, [{ kind: "file" }]);
    expect(overlay.textContent).toBe("active");

    dispatchOverlayDrag("drop", getByTestId("inner-zone"), [{ kind: "file" }]);
    expect(overlay.textContent).toBe("idle");
  });

  it.each([
    "Sources/Note.md",
    "Sources/Note.markdown",
    "Sources/Note.txt",
    "Sources/研究 Paper.pdf",
  ])("holds %s for an explicit choice instead of mutating Chat context", async (sourcePath) => {
    const file = new TestTFile(sourcePath);
    const setContextNotes = jest.fn();
    const onKnowledgeFileDrop = jest.fn();
    const { getByTestId } = render(
      <DropHarness
        app={createApp(file)}
        setContextNotes={setContextNotes}
        onKnowledgeFileDrop={onKnowledgeFileDrop}
      />
    );

    fireEvent.drop(getByTestId("drop-target"), {
      dataTransfer: createUriDataTransfer(sourcePath),
    });

    await waitFor(() => expect(onKnowledgeFileDrop).toHaveBeenCalledWith([file]));
    expect(setContextNotes).not.toHaveBeenCalled();
  });

  it("preserves direct Chat-context behavior for a non-Knowledge Vault canvas", async () => {
    const file = new TestTFile("Sources/Reference.canvas");
    const setContextNotes = jest.fn();
    const onKnowledgeFileDrop = jest.fn();
    const { getByTestId } = render(
      <DropHarness
        app={createApp(file)}
        setContextNotes={setContextNotes}
        onKnowledgeFileDrop={onKnowledgeFileDrop}
      />
    );

    fireEvent.drop(getByTestId("drop-target"), {
      dataTransfer: createUriDataTransfer(file.path),
    });

    await waitFor(() => expect(setContextNotes).toHaveBeenCalledTimes(1));
    expect(onKnowledgeFileDrop).not.toHaveBeenCalled();
  });

  it("preserves direct Chat-context behavior when no Knowledge callback is installed", async () => {
    const file = new TestTFile("Sources/Note.md");
    const setContextNotes = jest.fn();
    const { getByTestId } = render(
      <DropHarness app={createApp(file)} setContextNotes={setContextNotes} />
    );

    fireEvent.drop(getByTestId("drop-target"), {
      dataTransfer: createUriDataTransfer(file.path),
    });

    await waitFor(() => expect(setContextNotes).toHaveBeenCalledTimes(1));
  });

  it("ignores an Obsidian URI from another Vault", async () => {
    const file = new TestTFile("Sources/Note.md");
    const setContextNotes = jest.fn();
    const onKnowledgeFileDrop = jest.fn();
    const { getByTestId } = render(
      <DropHarness
        app={createApp(file)}
        setContextNotes={setContextNotes}
        onKnowledgeFileDrop={onKnowledgeFileDrop}
      />
    );

    fireEvent.drop(getByTestId("drop-target"), {
      dataTransfer: createUriDataTransfer(file.path, "Another Vault"),
    });
    await Promise.resolve();

    expect(onKnowledgeFileDrop).not.toHaveBeenCalled();
    expect(setContextNotes).not.toHaveBeenCalled();
  });
});
