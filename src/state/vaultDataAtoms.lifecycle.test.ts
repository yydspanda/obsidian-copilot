import type { App, MetadataCache, Vault } from "obsidian";

import { VaultDataManager } from "@/state/vaultDataAtoms";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  settingsStore: {
    set: jest.fn(),
  },
}));

jest.mock("@/utils", () => ({
  getTagsFromNote: jest.fn(() => []),
  isAllowedFileForNoteContext: jest.fn(() => true),
}));

jest.mock("obsidian", () => ({
  TFile: class MockTFile {},
  TFolder: class MockTFolder {},
}));

interface EventOwner {
  off: jest.Mock;
  on: jest.Mock;
}

interface VaultOwner extends EventOwner {
  getAllLoadedFiles: jest.Mock;
  getFiles: jest.Mock;
  getMarkdownFiles: jest.Mock;
}

interface TestOwner {
  app: App;
  metadataCache: EventOwner;
  vault: VaultOwner;
}

/**
 * Creates one minimal App with independently observable Vault and metadata listeners.
 *
 * @returns Exact lifecycle owner and its listener mocks
 */
function createOwner(): TestOwner {
  const vault: VaultOwner = {
    getAllLoadedFiles: jest.fn(() => []),
    getFiles: jest.fn(() => []),
    getMarkdownFiles: jest.fn(() => []),
    off: jest.fn(),
    on: jest.fn(),
  };
  const metadataCache: EventOwner = {
    off: jest.fn(),
    on: jest.fn(),
  };
  const app = {
    metadataCache: metadataCache as unknown as MetadataCache,
    vault: vault as unknown as Vault,
  } as App;
  return { app, metadataCache, vault };
}

describe("VaultDataManager lifecycle ownership", () => {
  let activeManager: VaultDataManager | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    activeManager?.cleanup();
    activeManager = undefined;
  });

  it("removes listeners from its captured Vault instead of the current global App", () => {
    const ownerA = createOwner();
    const ownerB = createOwner();
    const first = VaultDataManager.startLifecycle(ownerA.app);
    first.initialize();

    (window as unknown as { app: App }).app = ownerB.app;
    activeManager = VaultDataManager.startLifecycle(ownerB.app);
    activeManager.initialize();

    expect(ownerA.vault.off).toHaveBeenCalledTimes(4);
    expect(ownerA.metadataCache.off).toHaveBeenCalledTimes(1);
    expect(ownerB.vault.off).not.toHaveBeenCalled();
    expect(ownerB.metadataCache.off).not.toHaveBeenCalled();
  });

  it("does not let a delayed same-App cleanup remove replacement listeners", () => {
    const owner = createOwner();
    const first = VaultDataManager.startLifecycle(owner.app);
    first.initialize();

    const firstVaultHandlers = owner.vault.on.mock.calls.map(
      ([event, handler]) => [event, handler] as const
    );
    activeManager = VaultDataManager.startLifecycle(owner.app);
    activeManager.initialize();
    const offCallsAfterReplacement = owner.vault.off.mock.calls.length;
    const replacementVaultHandlers = owner.vault.on.mock.calls
      .slice(firstVaultHandlers.length)
      .map(([event, handler]) => [event, handler] as const);

    first.cleanup();

    expect(owner.vault.off).toHaveBeenCalledTimes(offCallsAfterReplacement);
    for (const [event, handler] of firstVaultHandlers) {
      expect(owner.vault.off).toHaveBeenCalledWith(event, handler);
    }
    for (const [event, handler] of replacementVaultHandlers) {
      expect(owner.vault.off).not.toHaveBeenCalledWith(event, handler);
    }
  });

  it("reads tags through the MetadataCache captured from its owner App", () => {
    const owner = createOwner();
    const otherOwner = createOwner();
    const file = { extension: "md", path: "note.md" };
    owner.vault.getMarkdownFiles.mockReturnValue([file]);
    (window as unknown as { app: App }).app = otherOwner.app;
    const { getTagsFromNote } = jest.requireMock<{
      getTagsFromNote: jest.Mock;
    }>("@/utils");

    activeManager = VaultDataManager.startLifecycle(owner.app);
    activeManager.initialize();

    expect(getTagsFromNote).toHaveBeenCalledWith(file, true, owner.app.metadataCache);
    expect(getTagsFromNote).toHaveBeenCalledWith(file, false, owner.app.metadataCache);
  });
});
