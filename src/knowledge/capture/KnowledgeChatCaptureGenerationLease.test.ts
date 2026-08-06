import { DelegatingKnowledgeChatCapturePort } from "@/knowledge/capture/DelegatingKnowledgeChatCapturePort";
import { KnowledgeChatCaptureGenerationLease } from "@/knowledge/capture/KnowledgeChatCaptureGenerationLease";
import type {
  KnowledgeChatCapturePort,
  KnowledgeChatCaptureReceipt,
} from "@/knowledge/capture/KnowledgeChatCapturePort";

/** Creates one delegate returning an identifiable receipt. */
function createDelegate(bundleId: string): KnowledgeChatCapturePort {
  return {
    addVaultSource: async (): Promise<KnowledgeChatCaptureReceipt> => ({
      status: "registered",
      bundleId,
    }),
  };
}

describe("KnowledgeChatCaptureGenerationLease", () => {
  it("publishes after subscribing and revokes on upstream invalidation", async () => {
    const stable = new DelegatingKnowledgeChatCapturePort();
    const delegate = createDelegate("personal");
    let invalidate = (): void => undefined;
    const lease = new KnowledgeChatCaptureGenerationLease({
      delegate,
      subscribeInvalidation: (listener) => {
        invalidate = listener;
        return () => undefined;
      },
      replaceDelegate: (next) => stable.replaceDelegate(next),
      revokeDelegate: (current) => stable.revokeDelegate(current),
      assertCurrent: () => undefined,
    });

    await expect(
      stable.addVaultSource({ sourcePath: "Sources/A.md" }, new AbortController().signal)
    ).resolves.toMatchObject({ bundleId: "personal" });

    invalidate();
    expect(() => lease.assertCurrent()).toThrow("aborted");
    await expect(
      stable.addVaultSource({ sourcePath: "Sources/A.md" }, new AbortController().signal)
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("does not let an old closed lease revoke a newer delegate", async () => {
    const stable = new DelegatingKnowledgeChatCapturePort();
    const oldLease = new KnowledgeChatCaptureGenerationLease({
      delegate: createDelegate("old"),
      subscribeInvalidation: () => () => undefined,
      replaceDelegate: (next) => stable.replaceDelegate(next),
      revokeDelegate: (current) => stable.revokeDelegate(current),
      assertCurrent: () => undefined,
    });
    stable.replaceDelegate(createDelegate("new"));

    oldLease.close();

    await expect(
      stable.addVaultSource({ sourcePath: "Sources/A.md" }, new AbortController().signal)
    ).resolves.toMatchObject({ bundleId: "new" });
  });
});
