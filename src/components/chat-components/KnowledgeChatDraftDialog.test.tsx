import { act, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";

import { KnowledgeChatDraftDialog } from "@/components/chat-components/KnowledgeChatDraftDialog";
import {
  KnowledgeChatCaptureError,
  type KnowledgeChatCapturePort,
  type KnowledgeChatDraftReceipt,
} from "@/knowledge/capture/KnowledgeChatCapturePort";

jest.mock("obsidian", () => ({ Notice: jest.fn() }));

const { Notice: noticeMock } = jest.requireMock<{ Notice: jest.Mock }>("obsidian");
const DRAFT_SESSION = Object.freeze({ bundleId: "personal", sourceRoot: "Sources" });

/** Creates one externally controlled promise for in-flight UI assertions. */
function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

/** Creates a complete capture port with an overridable draft command. */
function createPort(
  createKnowledgeDraft: KnowledgeChatCapturePort["createKnowledgeDraft"] = async () => ({
    status: "registered",
    bundleId: "personal",
    sourcePath: "Sources/Knowledge Draft abc.md",
  })
): KnowledgeChatCapturePort {
  return {
    addVaultSource: async () => ({ status: "registered", bundleId: "personal" }),
    prepareKnowledgeDraft: () => DRAFT_SESSION,
    createKnowledgeDraft,
  };
}

/** Renders the controlled dialog in the current element-owned document. */
function renderDialog(port: KnowledgeChatCapturePort = createPort()) {
  const onOpenChange = jest.fn();
  const rendered = render(
    <KnowledgeChatDraftDialog
      open={true}
      initialBody={"AI explanation\n\nVerify against the book."}
      container={window.document.body}
      capturePort={port}
      session={DRAFT_SESSION}
      onOpenChange={onOpenChange}
    />
  );
  return { ...rendered, onOpenChange };
}

describe("KnowledgeChatDraftDialog", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "setCssProps", {
      configurable: true,
      value(this: HTMLElement, properties: Record<string, string>) {
        for (const [name, value] of Object.entries(properties)) {
          this.style.setProperty(name, value);
        }
      },
    });
  });

  beforeEach(() => {
    noticeMock.mockClear();
  });

  it("requires an explicit title, editable body, and review confirmation", async () => {
    const createKnowledgeDraft = jest.fn<
      Promise<KnowledgeChatDraftReceipt>,
      Parameters<KnowledgeChatCapturePort["createKnowledgeDraft"]>
    >(async () => ({
      status: "registered",
      bundleId: "personal",
      sourcePath: "Sources/Knowledge Draft abc.md",
    }));
    const rendered = renderDialog(createPort(createKnowledgeDraft));
    const title = rendered.getByLabelText("Title") as HTMLInputElement;
    const body = rendered.getByLabelText("Markdown draft") as HTMLTextAreaElement;
    const confirmed = rendered.getByRole("checkbox", {
      name: /I reviewed this draft/u,
    });
    const submit = rendered.getByRole("button", { name: "Create source" });

    expect(title.value).toBe("");
    expect(body.value).toBe("AI explanation\n\nVerify against the book.");
    expect(rendered.getByText("Sources")).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(title, { target: { value: "Conformity reading note" } });
    fireEvent.change(body, { target: { value: "Checked explanation with book page 42." } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirmed);
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);
    await waitFor(() => expect(createKnowledgeDraft).toHaveBeenCalledTimes(1));
    const [session, request, signal] = createKnowledgeDraft.mock.calls[0];
    expect(session).toBe(DRAFT_SESSION);
    expect(request).toEqual({
      title: "Conformity reading note",
      body: "Checked explanation with book page 42.",
      reviewConfirmed: true,
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(signal.aborted).toBe(false);
    await waitFor(() => expect(rendered.onOpenChange).toHaveBeenCalledWith(false));
    expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining("Wiki is unchanged"));
  });

  it("locks duplicate submission while the durable command is pending", async () => {
    const deferred = createDeferred<KnowledgeChatDraftReceipt>();
    const createKnowledgeDraft = jest.fn(() => deferred.promise);
    const rendered = renderDialog(createPort(createKnowledgeDraft));
    fireEvent.change(rendered.getByLabelText("Title"), { target: { value: "Draft" } });
    fireEvent.click(rendered.getByRole("checkbox"));
    fireEvent.click(rendered.getByRole("button", { name: "Create source" }));

    const pending = rendered.getByRole("button", { name: "Creating source…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pending);
    expect(createKnowledgeDraft).toHaveBeenCalledTimes(1);

    await act(async () =>
      deferred.resolve({
        status: "registered",
        bundleId: "personal",
        sourcePath: "Sources/Knowledge Draft abc.md",
      })
    );
    expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining("Wiki is unchanged"));
  });

  it("closes without invoking the durable port when the user cancels", () => {
    const createKnowledgeDraft = jest.fn(createPort().createKnowledgeDraft);
    const rendered = renderDialog(createPort(createKnowledgeDraft));

    fireEvent.click(rendered.getByRole("button", { name: "Cancel" }));

    expect(rendered.onOpenChange).toHaveBeenCalledWith(false);
    expect(createKnowledgeDraft).not.toHaveBeenCalled();
  });

  it("lets the user stop a pending mutation without claiming it rolled back", async () => {
    const deferred = createDeferred<KnowledgeChatDraftReceipt>();
    let signal: AbortSignal | undefined;
    const port = createPort((_session, _request, nextSignal) => {
      signal = nextSignal;
      return deferred.promise;
    });
    const rendered = renderDialog(port);
    fireEvent.change(rendered.getByLabelText("Title"), { target: { value: "Draft" } });
    fireEvent.click(rendered.getByRole("checkbox"));
    fireEvent.click(rendered.getByRole("button", { name: "Create source" }));
    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));

    fireEvent.click(rendered.getByRole("button", { name: "Stop creation" }));

    expect(signal?.aborted).toBe(true);
    expect(rendered.onOpenChange).toHaveBeenCalledWith(false);
    expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining("Stop requested"));
    rendered.unmount();
    await act(async () =>
      deferred.resolve({
        status: "registered",
        bundleId: "personal",
        sourcePath: "Sources/Knowledge Draft abc.md",
      })
    );
    expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining("Wiki is unchanged"));
  });

  it("retains edited text and shows a path-free conflict message", async () => {
    const port = createPort(async () => {
      throw new KnowledgeChatCaptureError("draft_conflict");
    });
    const rendered = renderDialog(port);
    fireEvent.change(rendered.getByLabelText("Title"), { target: { value: "My draft" } });
    fireEvent.change(rendered.getByLabelText("Markdown draft"), {
      target: { value: "My checked text" },
    });
    fireEvent.click(rendered.getByRole("checkbox"));
    fireEvent.click(rendered.getByRole("button", { name: "Create source" }));

    await waitFor(() => expect(rendered.getByRole("alert")).toBeTruthy());
    expect(rendered.getByRole("alert").textContent).toContain("Nothing was overwritten");
    expect((rendered.getByLabelText("Title") as HTMLInputElement).value).toBe("My draft");
    expect((rendered.getByLabelText("Markdown draft") as HTMLTextAreaElement).value).toBe(
      "My checked text"
    );
    expect(rendered.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("cancels the linked command when its owning Chat view unmounts", async () => {
    const deferred = createDeferred<KnowledgeChatDraftReceipt>();
    let signal: AbortSignal | undefined;
    const port = createPort((_session, _request, nextSignal) => {
      signal = nextSignal;
      return deferred.promise;
    });
    const rendered = renderDialog(port);
    fireEvent.change(rendered.getByLabelText("Title"), { target: { value: "Draft" } });
    fireEvent.click(rendered.getByRole("checkbox"));
    fireEvent.click(rendered.getByRole("button", { name: "Create source" }));
    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));

    rendered.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      deferred.resolve({
        status: "registered",
        bundleId: "personal",
        sourcePath: "Sources/Knowledge Draft abc.md",
      })
    );
  });
});
