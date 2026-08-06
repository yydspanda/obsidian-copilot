import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { App, TFile } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";
import React, { useRef } from "react";

const TestTFile = ObsidianTFile as unknown as new (sourcePath: string) => TFile;

/** Minimal harness that installs the production drop listeners on one element. */
function DropHarness({
  app,
  setContextNotes,
  onKnowledgeFileDrop,
}: {
  app: App;
  setContextNotes: jest.Mock;
  onKnowledgeFileDrop: jest.Mock;
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

describe("useChatFileDrop", () => {
  it.each(["Sources/Note.md", "Sources/Note.markdown", "Sources/Note.txt"])(
    "holds %s for an explicit choice instead of mutating Chat context",
    async (sourcePath) => {
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
    }
  );

  it("preserves the existing direct Chat-context behavior for a Vault PDF", async () => {
    const file = new TestTFile("Sources/Reference.pdf");
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
