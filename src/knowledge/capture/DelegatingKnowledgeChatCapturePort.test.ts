import { DelegatingKnowledgeChatCapturePort } from "@/knowledge/capture/DelegatingKnowledgeChatCapturePort";
import {
  KnowledgeChatCaptureError,
  type KnowledgeChatCapturePort,
  type KnowledgeChatCaptureReceipt,
  type KnowledgeChatDraftReceipt,
} from "@/knowledge/capture/KnowledgeChatCapturePort";

/** Creates a delegate returning one stable test receipt. */
function createDelegate(bundleId: string): KnowledgeChatCapturePort {
  return {
    addVaultSource: async (): Promise<KnowledgeChatCaptureReceipt> => ({
      status: "registered",
      bundleId,
    }),
    prepareKnowledgeDraft: () => ({ bundleId, sourceRoot: "Sources" }),
    createKnowledgeDraft: async (): Promise<KnowledgeChatDraftReceipt> => ({
      status: "registered",
      bundleId,
      sourcePath: "Sources/Knowledge Draft.md",
    }),
  };
}

describe("DelegatingKnowledgeChatCapturePort", () => {
  it("starts unavailable and publishes only the installed generation", async () => {
    const port = new DelegatingKnowledgeChatCapturePort();
    const signal = new AbortController().signal;

    await expect(port.addVaultSource({ sourcePath: "Sources/A.md" }, signal)).rejects.toEqual(
      expect.objectContaining<Partial<KnowledgeChatCaptureError>>({ code: "unavailable" })
    );

    port.replaceDelegate(createDelegate("personal"));
    await expect(port.addVaultSource({ sourcePath: "Sources/A.md" }, signal)).resolves.toEqual({
      status: "registered",
      bundleId: "personal",
    });
  });

  it("aborts an old in-flight operation when its delegate is replaced", async () => {
    let finish: ((receipt: KnowledgeChatCaptureReceipt) => void) | undefined;
    const oldDelegate: KnowledgeChatCapturePort = {
      addVaultSource: () =>
        new Promise<KnowledgeChatCaptureReceipt>((resolve) => {
          finish = resolve;
        }),
      prepareKnowledgeDraft: () => ({ bundleId: "old-generation", sourceRoot: "Sources" }),
      createKnowledgeDraft: async () => ({
        status: "registered",
        bundleId: "old-generation",
        sourcePath: "Sources/Knowledge Draft.md",
      }),
    };
    const port = new DelegatingKnowledgeChatCapturePort();
    port.replaceDelegate(oldDelegate);

    const pending = port.addVaultSource(
      { sourcePath: "Sources/Old.md" },
      new AbortController().signal
    );
    await Promise.resolve();
    port.replaceDelegate(createDelegate("new-generation"));
    finish?.({ status: "registered", bundleId: "old-generation" });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      port.addVaultSource({ sourcePath: "Sources/New.md" }, new AbortController().signal)
    ).resolves.toMatchObject({ bundleId: "new-generation" });
  });

  it("returns a committed draft receipt even when the delegate generation is replaced afterward", async () => {
    let commit: ((receipt: KnowledgeChatDraftReceipt) => void) | undefined;
    const oldDelegate: KnowledgeChatCapturePort = {
      addVaultSource: async () => ({ status: "registered", bundleId: "old-generation" }),
      prepareKnowledgeDraft: () => ({ bundleId: "old-generation", sourceRoot: "Sources" }),
      createKnowledgeDraft: () =>
        new Promise<KnowledgeChatDraftReceipt>((resolve) => {
          commit = resolve;
        }),
    };
    const port = new DelegatingKnowledgeChatCapturePort();
    port.replaceDelegate(oldDelegate);
    const session = port.prepareKnowledgeDraft();
    expect(session).not.toBeNull();
    const pending = port.createKnowledgeDraft(
      session!,
      { title: "Draft", body: "Checked body", reviewConfirmed: true },
      new AbortController().signal
    );
    await Promise.resolve();

    commit?.({
      status: "registered",
      bundleId: "old-generation",
      sourcePath: "Sources/Knowledge Draft.md",
    });
    port.replaceDelegate(createDelegate("new-generation"));

    await expect(pending).resolves.toEqual({
      status: "registered",
      bundleId: "old-generation",
      sourcePath: "Sources/Knowledge Draft.md",
    });
  });

  it("does not start a draft mutation after caller cancellation", async () => {
    const delegate = createDelegate("personal");
    const createKnowledgeDraft = jest.spyOn(delegate, "createKnowledgeDraft");
    const port = new DelegatingKnowledgeChatCapturePort();
    port.replaceDelegate(delegate);
    const session = port.prepareKnowledgeDraft();
    expect(session).not.toBeNull();
    const controller = new AbortController();
    controller.abort();

    await expect(
      port.createKnowledgeDraft(
        session!,
        { title: "Draft", body: "Body", reviewConfirmed: true },
        controller.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(createKnowledgeDraft).not.toHaveBeenCalled();
  });

  it("does not redirect an open draft session into a replacement generation", async () => {
    const oldDelegate = createDelegate("old");
    const newDelegate = createDelegate("new");
    const createKnowledgeDraft = jest.spyOn(newDelegate, "createKnowledgeDraft");
    const port = new DelegatingKnowledgeChatCapturePort();
    port.replaceDelegate(oldDelegate);
    const session = port.prepareKnowledgeDraft();
    expect(session).toEqual({ bundleId: "old", sourceRoot: "Sources" });

    port.replaceDelegate(newDelegate);

    await expect(
      port.createKnowledgeDraft(
        session!,
        { title: "Draft", body: "Body", reviewConfirmed: true },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(createKnowledgeDraft).not.toHaveBeenCalled();
  });

  it("does not let an obsolete lease revoke a newer delegate", async () => {
    const oldDelegate = createDelegate("old");
    const newDelegate = createDelegate("new");
    const port = new DelegatingKnowledgeChatCapturePort();
    port.replaceDelegate(oldDelegate);
    port.replaceDelegate(newDelegate);

    port.revokeDelegate(oldDelegate);

    await expect(
      port.addVaultSource({ sourcePath: "Sources/A.md" }, new AbortController().signal)
    ).resolves.toMatchObject({ bundleId: "new" });
  });
});
