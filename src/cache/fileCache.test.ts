import type { Vault } from "obsidian";

import { FileCache, FileCacheDisposedError } from "@/cache/fileCache";

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

jest.mock("@/utils/hash", () => ({
  md5: jest.fn((value: string) => `hash:${value}`),
}));

jest.mock("obsidian", () => ({
  TFile: class MockTFile {},
}));

interface VaultFixture {
  adapter: {
    exists: jest.Mock;
    list: jest.Mock;
    mkdir: jest.Mock;
    read: jest.Mock;
    remove: jest.Mock;
    write: jest.Mock;
  };
  vault: Vault;
}

/**
 * Build a Vault with an observable cache-storage adapter.
 *
 * @returns Vault mock whose cache directory starts empty
 */
function createVault(): VaultFixture {
  const adapter = {
    exists: jest.fn(async () => false),
    list: jest.fn(async () => ({ files: [], folders: [] })),
    mkdir: jest.fn(async () => {}),
    read: jest.fn(async () => ""),
    remove: jest.fn(async () => {}),
    write: jest.fn(async () => {}),
  };
  return {
    adapter,
    vault: { adapter } as unknown as Vault,
  };
}

describe("FileCache Vault lifecycle", () => {
  let cache: FileCache<string> | undefined;

  afterEach(() => {
    cache?.dispose();
    cache = undefined;
  });

  it("reuses one cache for the same Vault and directory", () => {
    const vault = createVault();

    const first = FileCache.getInstance<string>(".cache", vault.vault);
    cache = first;
    const second = FileCache.getInstance<string>(".cache", vault.vault);

    expect(second).toBe(first);
  });

  it("rebinds on Vault change without carrying old memory entries", async () => {
    const firstVault = createVault();
    const secondVault = createVault();
    const first = FileCache.getInstance<string>(".cache", firstVault.vault);

    await first.set("shared-key", "old-vault-content");
    const second = FileCache.getInstance<string>(".cache", secondVault.vault);
    cache = second;

    expect(second).not.toBe(first);
    await expect(first.get("shared-key")).rejects.toBeInstanceOf(FileCacheDisposedError);
    await expect(second.get("shared-key")).resolves.toBeNull();
    expect(secondVault.adapter.read).not.toHaveBeenCalled();
  });

  it("uses the captured owner Vault instead of the global active Vault", async () => {
    const ownerVault = createVault();
    const otherVault = createVault();
    (window as unknown as { app: { vault: Vault } }).app = { vault: otherVault.vault };
    cache = FileCache.getInstance<string>(".cache", ownerVault.vault);

    await cache.set("owner-key", "owner-content");

    expect(ownerVault.adapter.mkdir).toHaveBeenCalledWith(".cache");
    expect(ownerVault.adapter.write).toHaveBeenCalledWith(".cache/owner-key.md", "owner-content");
    expect(otherVault.adapter.exists).not.toHaveBeenCalled();
    expect(otherVault.adapter.write).not.toHaveBeenCalled();
  });

  it("disposes idempotently and creates a clean replacement", async () => {
    const vault = createVault();
    const first = FileCache.getInstance<string>(".cache", vault.vault);
    await first.set("key", "content");

    first.dispose();
    first.dispose();
    const second = FileCache.getInstance<string>(".cache", vault.vault);
    cache = second;

    expect(second).not.toBe(first);
    await expect(first.get("key")).rejects.toBeInstanceOf(FileCacheDisposedError);
    await expect(second.get("key")).resolves.toBeNull();
  });
});
