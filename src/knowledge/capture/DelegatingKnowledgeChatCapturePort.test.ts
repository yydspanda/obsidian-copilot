import { DelegatingKnowledgeChatCapturePort } from "@/knowledge/capture/DelegatingKnowledgeChatCapturePort";
import {
  KnowledgeChatCaptureError,
  type KnowledgeChatCapturePort,
  type KnowledgeChatCaptureReceipt,
} from "@/knowledge/capture/KnowledgeChatCapturePort";

/** Creates a delegate returning one stable test receipt. */
function createDelegate(bundleId: string): KnowledgeChatCapturePort {
  return {
    addVaultSource: async (): Promise<KnowledgeChatCaptureReceipt> => ({
      status: "registered",
      bundleId,
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
