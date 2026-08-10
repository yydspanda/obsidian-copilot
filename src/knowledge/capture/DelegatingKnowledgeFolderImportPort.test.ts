import { DelegatingKnowledgeFolderImportPort } from "@/knowledge/capture/DelegatingKnowledgeFolderImportPort";
import {
  KnowledgeFolderImportError,
  type KnowledgeFolderImportPort,
  type KnowledgeFolderImportReceipt,
} from "@/knowledge/capture/KnowledgeFolderImportPort";

const EMPTY_FILES: readonly File[] = Object.freeze([]);

/** Creates a delegate returning one identifiable aggregate receipt. */
function createDelegate(bundleId: string): KnowledgeFolderImportPort {
  return {
    importFolder: async (): Promise<KnowledgeFolderImportReceipt> => ({
      status: "completed",
      bundleId,
      discoveredFiles: 1,
      eligibleFiles: 1,
      importedFiles: 1,
      reusedFiles: 0,
      skippedFiles: 0,
      conflictFiles: 0,
      failedFiles: 0,
      importedBytes: 1,
    }),
  };
}

describe("DelegatingKnowledgeFolderImportPort", () => {
  it("starts unavailable and publishes only the installed generation", async () => {
    const port = new DelegatingKnowledgeFolderImportPort();
    const signal = new AbortController().signal;
    await expect(port.importFolder({ files: EMPTY_FILES }, signal)).rejects.toEqual(
      expect.objectContaining<Partial<KnowledgeFolderImportError>>({ code: "unavailable" })
    );

    port.replaceDelegate(createDelegate("personal"));
    await expect(port.importFolder({ files: EMPTY_FILES }, signal)).resolves.toMatchObject({
      bundleId: "personal",
    });
  });

  it("aborts an old in-flight import when its delegate is replaced", async () => {
    let finish: ((receipt: KnowledgeFolderImportReceipt) => void) | undefined;
    const oldDelegate: KnowledgeFolderImportPort = {
      importFolder: () =>
        new Promise<KnowledgeFolderImportReceipt>((resolve) => {
          finish = resolve;
        }),
    };
    const port = new DelegatingKnowledgeFolderImportPort();
    port.replaceDelegate(oldDelegate);
    const pending = port.importFolder({ files: EMPTY_FILES }, new AbortController().signal);
    await Promise.resolve();

    port.replaceDelegate(createDelegate("new"));
    finish?.({
      status: "completed",
      bundleId: "old",
      discoveredFiles: 0,
      eligibleFiles: 0,
      importedFiles: 0,
      reusedFiles: 0,
      skippedFiles: 0,
      conflictFiles: 0,
      failedFiles: 0,
      importedBytes: 0,
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      port.importFolder({ files: EMPTY_FILES }, new AbortController().signal)
    ).resolves.toMatchObject({ bundleId: "new" });
  });

  it("does not let an obsolete lease revoke a newer delegate", async () => {
    const oldDelegate = createDelegate("old");
    const port = new DelegatingKnowledgeFolderImportPort();
    port.replaceDelegate(oldDelegate);
    port.replaceDelegate(createDelegate("new"));

    port.revokeDelegate(oldDelegate);
    await expect(
      port.importFolder({ files: EMPTY_FILES }, new AbortController().signal)
    ).resolves.toMatchObject({ bundleId: "new" });
  });
});
