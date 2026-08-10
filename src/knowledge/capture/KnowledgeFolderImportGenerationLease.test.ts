import { DelegatingKnowledgeFolderImportPort } from "@/knowledge/capture/DelegatingKnowledgeFolderImportPort";
import {
  type KnowledgeFolderImportPort,
  type KnowledgeFolderImportReceipt,
} from "@/knowledge/capture/KnowledgeFolderImportPort";
import { KnowledgeFolderImportGenerationLease } from "@/knowledge/capture/KnowledgeFolderImportGenerationLease";

const EMPTY_FILES: readonly File[] = Object.freeze([]);

/** Creates a delegate returning one identifiable aggregate receipt. */
function createDelegate(bundleId: string): KnowledgeFolderImportPort {
  return {
    importFolder: async (): Promise<KnowledgeFolderImportReceipt> => ({
      status: "completed",
      bundleId,
      discoveredFiles: 0,
      eligibleFiles: 0,
      importedFiles: 0,
      reusedFiles: 0,
      skippedFiles: 0,
      conflictFiles: 0,
      failedFiles: 0,
      importedBytes: 0,
    }),
  };
}

describe("KnowledgeFolderImportGenerationLease", () => {
  it("publishes after subscribing and revokes on upstream invalidation", async () => {
    const stable = new DelegatingKnowledgeFolderImportPort();
    const delegate = createDelegate("personal");
    let invalidate = (): void => undefined;
    const lease = new KnowledgeFolderImportGenerationLease({
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
      stable.importFolder({ files: EMPTY_FILES }, new AbortController().signal)
    ).resolves.toMatchObject({ bundleId: "personal" });
    invalidate();
    expect(() => lease.assertCurrent()).toThrow("aborted");
    await expect(
      stable.importFolder({ files: EMPTY_FILES }, new AbortController().signal)
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("does not let an old closed lease revoke a newer delegate", async () => {
    const stable = new DelegatingKnowledgeFolderImportPort();
    const oldLease = new KnowledgeFolderImportGenerationLease({
      delegate: createDelegate("old"),
      subscribeInvalidation: () => () => undefined,
      replaceDelegate: (next) => stable.replaceDelegate(next),
      revokeDelegate: (current) => stable.revokeDelegate(current),
      assertCurrent: () => undefined,
    });
    stable.replaceDelegate(createDelegate("new"));

    oldLease.close();
    await expect(
      stable.importFolder({ files: EMPTY_FILES }, new AbortController().signal)
    ).resolves.toMatchObject({ bundleId: "new" });
  });
});
