import { ChatAttachmentIntentCard } from "@/components/chat-components/ChatAttachmentIntentCard";
import { fireEvent, render, screen } from "@testing-library/react";
import { TFile } from "obsidian";
import React from "react";

const TestTFile = TFile as unknown as new (sourcePath: string) => TFile;

/** Creates the minimal immutable TFile projection rendered by the choice card. */
function createFile(path: string): TFile {
  return new TestTFile(path);
}

describe("ChatAttachmentIntentCard", () => {
  it("does nothing before an explicit choice and routes each action separately", () => {
    const file = createFile("Sources/Note.md");
    const onUseInChat = jest.fn();
    const onAddToKnowledge = jest.fn();
    const onDismiss = jest.fn();
    render(
      <ChatAttachmentIntentCard
        files={[file]}
        onUseInChat={onUseInChat}
        onAddToKnowledge={onAddToKnowledge}
        onDismiss={onDismiss}
      />
    );

    expect(onUseInChat).not.toHaveBeenCalled();
    expect(onAddToKnowledge).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Use in this chat" }));
    expect(onUseInChat).toHaveBeenCalledWith(file);
    expect(onAddToKnowledge).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Add to Knowledge" }));
    expect(onAddToKnowledge).toHaveBeenCalledWith(file);
    expect(onUseInChat).toHaveBeenCalledTimes(1);
  });

  it("dismisses without selecting either destination", () => {
    const file = createFile("Sources/Note.txt");
    const onUseInChat = jest.fn();
    const onAddToKnowledge = jest.fn();
    const onDismiss = jest.fn();
    render(
      <ChatAttachmentIntentCard
        files={[file]}
        onUseInChat={onUseInChat}
        onAddToKnowledge={onAddToKnowledge}
        onDismiss={onDismiss}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Note.txt" }));

    expect(onDismiss).toHaveBeenCalledWith(file);
    expect(onUseInChat).not.toHaveBeenCalled();
    expect(onAddToKnowledge).not.toHaveBeenCalled();
  });
});
