import { TFile, type Vault } from "obsidian";

import { FileCache } from "@/cache/fileCache";

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

describe("fileCache", () => {
  describe("FileCache", () => {
    const cache = FileCache.getInstance<unknown>(".cache");

    describe("getInstance()", () => {
      it("reuses the singleton without capturing a Vault", () => {
        expect(FileCache.getInstance<unknown>(".other-cache")).toBe(cache);
      });
    });

    describe("getCacheKey()", () => {
      it("hashes file identity together with optional context", () => {
        const file = Object.assign(new TFile(), {
          path: "notes/example.md",
          stat: { mtime: 20, size: 10 },
        });

        expect(cache.getCacheKey(file, "context")).toBe("hash:notes/example.md:10:20:context");
      });
    });

    describe("get()", () => {
      it("reads and parses cached content through the supplied Vault", async () => {
        const owner = createVault();
        const other = createVault();
        owner.adapter.exists.mockResolvedValue(true);
        owner.adapter.read.mockResolvedValue('{"enabled":true}');

        await expect(cache.get(owner.vault, "disk-json-key")).resolves.toEqual({ enabled: true });
        expect(owner.adapter.exists).toHaveBeenCalledWith(".cache/disk-json-key.md");
        expect(owner.adapter.read).toHaveBeenCalledWith(".cache/disk-json-key.md");
        expect(other.adapter.exists).not.toHaveBeenCalled();
      });
    });

    describe("set()", () => {
      it("creates and writes the cache through the supplied Vault", async () => {
        const owner = createVault();
        const other = createVault();

        await cache.set(owner.vault, "owner-key", "owner-content");

        expect(owner.adapter.mkdir).toHaveBeenCalledWith(".cache");
        expect(owner.adapter.write).toHaveBeenCalledWith(".cache/owner-key.md", "owner-content");
        expect(other.adapter.exists).not.toHaveBeenCalled();
        expect(other.adapter.write).not.toHaveBeenCalled();
      });
    });

    describe("remove()", () => {
      it("removes memory and disk entries through the supplied Vault", async () => {
        const vault = createVault();
        vault.adapter.exists.mockResolvedValue(true);
        await cache.set(vault.vault, "remove-key", "content");

        await cache.remove(vault.vault, "remove-key");

        expect(vault.adapter.remove).toHaveBeenCalledWith(".cache/remove-key.md");
      });
    });

    describe("clear()", () => {
      it("clears memory and removes listed disk entries through the supplied Vault", async () => {
        const vault = createVault();
        const emptyVault = createVault();
        vault.adapter.exists.mockResolvedValue(true);
        vault.adapter.list.mockResolvedValue({
          files: [".cache/first.md", ".cache/second.md"],
          folders: [],
        });
        await cache.set(vault.vault, "clear-memory-key", "content");

        await cache.clear(vault.vault);

        expect(vault.adapter.remove).toHaveBeenNthCalledWith(1, ".cache/first.md");
        expect(vault.adapter.remove).toHaveBeenNthCalledWith(2, ".cache/second.md");
        await expect(cache.get(emptyVault.vault, "clear-memory-key")).resolves.toBeNull();
      });
    });
  });
});
