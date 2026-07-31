import type { App, Vault } from "obsidian";

import { logFileManager } from "@/logFileManager";

jest.mock("@/encryptionService", () => ({
  isSensitiveKey: jest.fn(() => false),
}));

jest.mock("@/errorFormat", () => ({
  err2String: jest.fn((value: unknown) => String(value)),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({})),
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(async () => undefined),
}));

jest.mock("obsidian", () => ({
  TFile: class MockTFile {},
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/**
 * Creates an externally controlled Promise.
 *
 * @returns Deferred Promise controls
 */
function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

/**
 * Creates a Vault whose adapter calls can be observed independently.
 *
 * @param exists - Result or deferred result for adapter.exists
 * @returns Vault and its adapter mocks
 */
function createVault(exists: boolean | Promise<boolean>): {
  adapter: { exists: jest.Mock; write: jest.Mock; remove: jest.Mock };
  vault: Vault;
} {
  const adapter = {
    exists: jest.fn(async () => exists),
    write: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  };
  return {
    adapter,
    vault: {
      adapter,
      create: jest.fn(async () => undefined),
      getAbstractFileByPath: jest.fn(() => null),
    } as unknown as Vault,
  };
}

/**
 * Creates an App whose Vault and Workspace can be distinguished from other owners.
 *
 * @param vault - Exact Vault owned by the App
 * @returns App with observable Workspace access
 */
function createApp(vault: Vault): App {
  return {
    vault,
    workspace: {
      getLeaf: jest.fn(() => ({
        openFile: jest.fn(async () => undefined),
      })),
    },
  } as unknown as App;
}

describe("LogFileManager lifecycle Vault ownership", () => {
  it("keeps an in-flight explicit flush on its captured Vault after the global App changes", async () => {
    const ownerExists = createDeferred<boolean>();
    const ownerA = createVault(ownerExists.promise);
    const ownerB = createVault(true);
    (window as unknown as { app: App }).app = { vault: ownerB.vault } as App;
    await logFileManager.append("INFO", "owner-a-entry");

    const flush = logFileManager.flush(ownerA.vault);
    (window as unknown as { app: App }).app = { vault: ownerB.vault } as App;
    ownerExists.resolve(true);
    await flush;

    expect(ownerA.adapter.exists).toHaveBeenCalledWith("copilot/copilot-log.md");
    expect(ownerA.adapter.write).toHaveBeenCalledWith(
      "copilot/copilot-log.md",
      expect.stringContaining("owner-a-entry")
    );
    expect(ownerB.adapter.exists).not.toHaveBeenCalled();
    expect(ownerB.adapter.write).not.toHaveBeenCalled();
  });

  it("keeps an in-flight clear on its explicit Vault after the global App changes", async () => {
    const ownerExists = createDeferred<boolean>();
    const ownerA = createVault(ownerExists.promise);
    const ownerB = createVault(true);
    (window as unknown as { app: App }).app = createApp(ownerB.vault);

    const clear = logFileManager.clear(ownerA.vault);
    (window as unknown as { app: App }).app = createApp(ownerB.vault);
    ownerExists.resolve(true);
    await clear;

    expect(ownerA.adapter.exists).toHaveBeenCalledWith("copilot/copilot-log.md");
    expect(ownerA.adapter.remove).toHaveBeenCalledWith("copilot/copilot-log.md");
    expect(ownerB.adapter.exists).not.toHaveBeenCalled();
    expect(ownerB.adapter.remove).not.toHaveBeenCalled();
  });

  it("keeps an in-flight open on its explicit App after the global App changes", async () => {
    const ownerExists = createDeferred<boolean>();
    const ownerA = createVault(ownerExists.promise);
    const ownerB = createVault(true);
    const appA = createApp(ownerA.vault);
    const appB = createApp(ownerB.vault);
    (window as unknown as { app: App }).app = appB;
    await logFileManager.append("INFO", "owner-a-open-entry");

    const open = logFileManager.openLogFile(appA);
    (window as unknown as { app: App }).app = appB;
    ownerExists.resolve(true);
    await open;

    expect(ownerA.adapter.exists).toHaveBeenCalledWith("copilot/copilot-log.md");
    expect(ownerA.adapter.write).toHaveBeenCalledWith(
      "copilot/copilot-log.md",
      expect.stringContaining("owner-a-open-entry")
    );
    expect(ownerB.adapter.exists).not.toHaveBeenCalled();
    expect(ownerB.adapter.write).not.toHaveBeenCalled();
  });
});
