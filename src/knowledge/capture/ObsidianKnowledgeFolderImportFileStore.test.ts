jest.mock("obsidian", () => {
  const path = jest.requireActual<typeof import("node:path")>("node:path");

  class FileSystemAdapter {
    /** Creates one fake desktop adapter rooted at a real temporary directory. */
    constructor(private readonly basePath: string) {}

    /** Returns the fake Vault root. */
    getBasePath(): string {
      return this.basePath;
    }

    /** Resolves one canonical Vault-relative path beneath the fake root. */
    getFullPath(vaultPath: string): string {
      return path.join(this.basePath, ...vaultPath.split("/"));
    }
  }

  return { FileSystemAdapter };
});
jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { FileSystemAdapter } from "obsidian";

import { logWarn } from "@/logger";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import {
  KnowledgeFolderImportFileStoreError,
  ObsidianKnowledgeFolderImportFileStore,
  type KnowledgeFolderImportNodeFileHandle,
  type KnowledgeFolderImportNodeFileSystem,
  type KnowledgeFolderImportNodeIdentityStat,
  type KnowledgeFolderImportNodeRuntime,
  type KnowledgeFolderImportNodeStat,
} from "@/knowledge/capture/ObsidianKnowledgeFolderImportFileStore";

type TestFileSystemAdapter = FileSystemAdapter & {
  getFullPath(vaultPath: string): string;
};

const temporaryDirectories: string[] = [];
const SOURCE_ROOT = "Sources/Imported";

/** Loads the real native modules used by the filesystem-backed test edge. */
function loadTestRuntime(): KnowledgeFolderImportNodeRuntime {
  return {
    fs: fs as unknown as KnowledgeFolderImportNodeFileSystem,
    path,
    randomUUID,
  };
}

/** Creates one fake FileSystemAdapter over a fresh temporary Vault. */
async function createAdapter(createSourceRoot = true): Promise<TestFileSystemAdapter> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-folder-import-store-"));
  temporaryDirectories.push(root);
  const AdapterConstructor = FileSystemAdapter as unknown as new (
    rootPath: string
  ) => TestFileSystemAdapter;
  const adapter = new AdapterConstructor(root);
  if (createSourceRoot) {
    await fs.mkdir(adapter.getFullPath(SOURCE_ROOT), { recursive: true });
  }
  return adapter;
}

/** Creates one current generation capability for a test store. */
function createGeneration(isCurrent: () => boolean = () => true) {
  return {
    /** Rejects when the test generation has been revoked. */
    assertCurrent: () => {
      if (!isCurrent()) throw new Error("stale test generation");
    },
  };
}

/** Forwards both number and bigint stat overloads from one wrapped native handle. */
function forwardHandleStat(
  handle: KnowledgeFolderImportNodeFileHandle
): KnowledgeFolderImportNodeFileHandle["stat"] {
  return createHandleStatReader(
    () => handle.stat(),
    () => handle.stat({ bigint: true })
  );
}

/** Creates one exact overloaded stat reader from separate number and bigint observations. */
function createHandleStatReader(
  readNumberStat: () => Promise<KnowledgeFolderImportNodeStat>,
  readIdentityStat: () => Promise<KnowledgeFolderImportNodeIdentityStat>
): KnowledgeFolderImportNodeFileHandle["stat"] {
  return ((options?: { bigint: true }) =>
    options?.bigint === true
      ? readIdentityStat()
      : readNumberStat()) as KnowledgeFolderImportNodeFileHandle["stat"];
}

/** Creates one native-style rejection carrying only a stable Node error code. */
function createNodeError(code: string): Error & { readonly code: string } {
  return Object.assign(new Error("simulated native rejection"), { code });
}

/** Forwards both lstat overloads while replacing one case-insensitive alias. */
function createAliasedLstat(
  baseFileSystem: KnowledgeFolderImportNodeFileSystem,
  requestedPath: string,
  actualPath: string
): KnowledgeFolderImportNodeFileSystem["lstat"] {
  return ((targetPath: string, options?: { bigint: true }) => {
    const resolvedPath = targetPath === requestedPath ? actualPath : targetPath;
    return options?.bigint === true
      ? baseFileSystem.lstat(resolvedPath, { bigint: true })
      : baseFileSystem.lstat(resolvedPath);
  }) as KnowledgeFolderImportNodeFileSystem["lstat"];
}

/** Creates one store over a real temporary Vault. */
function createStore(
  adapter: TestFileSystemAdapter,
  runtimeLoader: () => KnowledgeFolderImportNodeRuntime = loadTestRuntime,
  isCurrent: () => boolean = () => true
): ObsidianKnowledgeFolderImportFileStore {
  return new ObsidianKnowledgeFolderImportFileStore(
    adapter,
    SOURCE_ROOT,
    createGeneration(isCurrent),
    runtimeLoader
  );
}

/** Lists private publication temporaries below one native directory. */
async function listTemporaryFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory);
  return entries.filter((entry) => entry.startsWith(".") && entry.endsWith(".tmp"));
}

afterEach(async () => {
  (logWarn as jest.Mock).mockClear();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe("ObsidianKnowledgeFolderImportFileStore", () => {
  it("recursively creates authorized parents and publishes exact binary bytes once", async () => {
    const adapter = await createAdapter();
    const store = createStore(adapter);
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const destination = `${SOURCE_ROOT}/my_idea/nested/source.pdf`;

    await expect(store.publish(destination, bytes, new AbortController().signal)).resolves.toEqual({
      status: "created",
      contentHash: createSourceContentHash(bytes),
    });
    await expect(fs.readFile(adapter.getFullPath(destination))).resolves.toEqual(
      Buffer.from(bytes)
    );
    await expect(
      listTemporaryFiles(adapter.getFullPath(`${SOURCE_ROOT}/my_idea/nested`))
    ).resolves.toEqual([]);
  });

  it("ensures missing parents directly while retaining an existing exact source root", async () => {
    const adapter = await createAdapter();
    const store = createStore(adapter);
    const destination = `${SOURCE_ROOT}/one/two/note.md`;

    await store.ensureParents(destination, new AbortController().signal);

    await expect(fs.stat(adapter.getFullPath(`${SOURCE_ROOT}/one/two`))).resolves.toMatchObject({});
    await expect(fs.stat(adapter.getFullPath(destination))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reuses an existing exact-byte file without changing its native identity", async () => {
    const adapter = await createAdapter();
    const store = createStore(adapter);
    const bytes = new Uint8Array([37, 80, 68, 70, 45]);
    const destination = `${SOURCE_ROOT}/my_idea/source.pdf`;
    await fs.mkdir(path.dirname(adapter.getFullPath(destination)), { recursive: true });
    await fs.writeFile(adapter.getFullPath(destination), bytes);
    const before = await fs.stat(adapter.getFullPath(destination));

    await expect(store.publish(destination, bytes, new AbortController().signal)).resolves.toEqual({
      status: "reused",
      contentHash: createSourceContentHash(bytes),
    });
    const after = await fs.stat(adapter.getFullPath(destination));
    expect(after.ino).toBe(before.ino);
    await expect(fs.readFile(adapter.getFullPath(destination))).resolves.toEqual(
      Buffer.from(bytes)
    );
  });

  it("rejects an existing parent whose actual case differs before opening or writing", async () => {
    const adapter = await createAdapter();
    const baseRuntime = loadTestRuntime();
    const requestedParent = adapter.getFullPath(`${SOURCE_ROOT}/my_idea`);
    const actualParent = adapter.getFullPath(`${SOURCE_ROOT}/My_Idea`);
    await fs.mkdir(actualParent);
    let openCalls = 0;
    let writeCalls = 0;
    let linkCalls = 0;
    const caseInsensitiveRuntime: KnowledgeFolderImportNodeRuntime = {
      ...baseRuntime,
      fs: {
        ...baseRuntime.fs,
        /** Resolves the requested case variant to the existing actual directory spelling. */
        realpath: (targetPath) =>
          targetPath === requestedParent
            ? Promise.resolve(actualParent)
            : baseRuntime.fs.realpath(targetPath),
        lstat: createAliasedLstat(baseRuntime.fs, requestedParent, actualParent),
        /** Simulates case-insensitive EEXIST for the differently cased directory. */
        mkdir: async (targetPath, options) => {
          if (targetPath === requestedParent) throw createNodeError("EEXIST");
          await baseRuntime.fs.mkdir(targetPath, options);
        },
        /** Counts any forbidden file-open boundary reached after the case mismatch. */
        open: async (targetPath, flags, mode) => {
          openCalls += 1;
          const handle = await baseRuntime.fs.open(targetPath, flags, mode);
          return {
            /** Counts and forwards any forbidden exact-byte write. */
            writeFile: async (data) => {
              writeCalls += 1;
              await handle.writeFile(data);
            },
            /** Reads bytes through the bound native handle. */
            readFile: () => handle.readFile(),
            /** Reads number or bigint stat through the bound native handle. */
            stat: forwardHandleStat(handle),
            /** Flushes the bound native handle. */
            sync: () => handle.sync(),
            /** Closes the bound native handle. */
            close: () => handle.close(),
          } satisfies KnowledgeFolderImportNodeFileHandle;
        },
        /** Counts any forbidden publication after the case mismatch. */
        link: async (existingPath, newPath) => {
          linkCalls += 1;
          await baseRuntime.fs.link(existingPath, newPath);
        },
      },
    };
    const store = createStore(adapter, () => caseInsensitiveRuntime);

    await expect(
      store.publish(
        `${SOURCE_ROOT}/my_idea/source.md`,
        new Uint8Array([1, 2, 3]),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "destination_unavailable" });
    expect(openCalls).toBe(0);
    expect(writeCalls).toBe(0);
    expect(linkCalls).toBe(0);
    await expect(fs.readdir(actualParent)).resolves.toEqual([]);
    await expect(fs.stat(requestedParent)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not reuse an exact-byte target whose actual filename case differs", async () => {
    const adapter = await createAdapter();
    const baseRuntime = loadTestRuntime();
    const requestedParent = adapter.getFullPath(`${SOURCE_ROOT}/my_idea`);
    const requestedTarget = path.join(requestedParent, "source.md");
    const actualTarget = path.join(requestedParent, "Source.md");
    const bytes = new Uint8Array([37, 80, 68, 70]);
    await fs.mkdir(requestedParent);
    await fs.writeFile(actualTarget, bytes);
    let openCalls = 0;
    let writeCalls = 0;
    let linkCalls = 0;
    const caseInsensitiveRuntime: KnowledgeFolderImportNodeRuntime = {
      ...baseRuntime,
      fs: {
        ...baseRuntime.fs,
        /** Returns the actual on-disk spelling for the case-insensitive target lookup. */
        realpath: (targetPath) =>
          targetPath === requestedTarget
            ? Promise.resolve(actualTarget)
            : baseRuntime.fs.realpath(targetPath),
        lstat: createAliasedLstat(baseRuntime.fs, requestedTarget, actualTarget),
        /** Counts any forbidden read or private temporary open after the mismatch. */
        open: async (targetPath, flags, mode) => {
          openCalls += 1;
          const handle = await baseRuntime.fs.open(targetPath, flags, mode);
          return {
            /** Counts and forwards any forbidden exact-byte write. */
            writeFile: async (data) => {
              writeCalls += 1;
              await handle.writeFile(data);
            },
            /** Reads bytes through the bound native handle. */
            readFile: () => handle.readFile(),
            /** Reads number or bigint stat through the bound native handle. */
            stat: forwardHandleStat(handle),
            /** Flushes the bound native handle. */
            sync: () => handle.sync(),
            /** Closes the bound native handle. */
            close: () => handle.close(),
          } satisfies KnowledgeFolderImportNodeFileHandle;
        },
        /** Counts any forbidden publication after the case mismatch. */
        link: async (existingPath, newPath) => {
          linkCalls += 1;
          await baseRuntime.fs.link(existingPath, newPath);
        },
      },
    };
    const store = createStore(adapter, () => caseInsensitiveRuntime);

    await expect(
      store.publish(`${SOURCE_ROOT}/my_idea/source.md`, bytes, new AbortController().signal)
    ).rejects.toMatchObject({ code: "destination_unavailable" });
    expect(openCalls).toBe(0);
    expect(writeCalls).toBe(0);
    expect(linkCalls).toBe(0);
    await expect(fs.readFile(actualTarget)).resolves.toEqual(Buffer.from(bytes));
    await expect(fs.stat(requestedTarget)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(listTemporaryFiles(requestedParent)).resolves.toEqual([]);
  });

  it("derives new Windows descendants from the real source root without drive-case mismatch", async () => {
    const AdapterConstructor = FileSystemAdapter as unknown as new (
      rootPath: string
    ) => TestFileSystemAdapter;
    const adapter = new AdapterConstructor("c:\\Users\\Owner\\Vault");
    const realVaultRoot = "C:\\Users\\Owner\\Vault";
    const realSourceRoot = `${realVaultRoot}\\Sources\\Imported`;
    const expectedParent = `${realSourceRoot}\\my_idea`;
    const directories = new Set([realSourceRoot]);
    const directoryStat: KnowledgeFolderImportNodeStat = {
      size: 0,
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    };
    const fakeFileSystem: KnowledgeFolderImportNodeFileSystem = {
      /** Canonicalizes only the adapter drive while preserving descendant spellings. */
      realpath: async (targetPath) =>
        targetPath === adapter.getBasePath() ? realVaultRoot : targetPath,
      /** Observes directories created in the simulated Windows namespace. */
      lstat: ((targetPath: string) => {
        if (!directories.has(targetPath)) throw createNodeError("ENOENT");
        return Promise.resolve(directoryStat);
      }) as KnowledgeFolderImportNodeFileSystem["lstat"],
      /** Creates one exact descendant directory in the simulated namespace. */
      mkdir: async (targetPath) => {
        if (directories.has(targetPath)) throw createNodeError("EEXIST");
        directories.add(targetPath);
      },
      /** Rejects an unexpected file-open boundary in this parent-only test. */
      open: async () => {
        throw new Error("unexpected open");
      },
      /** Rejects an unexpected publication boundary in this parent-only test. */
      link: async () => {
        throw new Error("unexpected link");
      },
      /** Rejects an unexpected cleanup boundary in this parent-only test. */
      unlink: async () => {
        throw new Error("unexpected unlink");
      },
    };
    const store = createStore(adapter, () => ({
      fs: fakeFileSystem,
      path: path.win32,
      randomUUID,
    }));

    await expect(
      store.ensureParents(`${SOURCE_ROOT}/my_idea/source.md`, new AbortController().signal)
    ).resolves.toBeUndefined();
    expect(directories).toContain(expectedParent);
  });

  it("uses bigint identity when number inode fields cannot be represented safely", async () => {
    const adapter = await createAdapter();
    const baseRuntime = loadTestRuntime();
    const bigintRuntime: KnowledgeFolderImportNodeRuntime = {
      ...baseRuntime,
      fs: {
        ...baseRuntime.fs,
        /** Returns lossy number identity fields while preserving exact bigint stat support. */
        open: async (targetPath, flags, mode) => {
          const handle = await baseRuntime.fs.open(targetPath, flags, mode);
          if (flags !== "wx") return handle;
          return {
            /** Writes exact test bytes through the bound native handle. */
            writeFile: (data) => handle.writeFile(data),
            /** Reads exact test bytes through the bound native handle. */
            readFile: () => handle.readFile(),
            /** Separates intentionally unsafe number fields from exact bigint identity. */
            stat: createHandleStatReader(
              async () => {
                const observed = await handle.stat();
                return {
                  size: observed.size,
                  dev: Number.MAX_SAFE_INTEGER + 1,
                  ino: Number.MAX_SAFE_INTEGER + 2,
                  isDirectory: () => observed.isDirectory(),
                  isFile: () => observed.isFile(),
                  isSymbolicLink: () => observed.isSymbolicLink?.() === true,
                } as KnowledgeFolderImportNodeStat;
              },
              () => handle.stat({ bigint: true })
            ),
            /** Flushes the exact private temporary. */
            sync: () => handle.sync(),
            /** Closes the bound native handle. */
            close: () => handle.close(),
          } satisfies KnowledgeFolderImportNodeFileHandle;
        },
      },
    };
    const store = createStore(adapter, () => bigintRuntime);
    const destination = `${SOURCE_ROOT}/bigint/source.pdf`;
    const bytes = new Uint8Array([1, 3, 5, 7]);

    await expect(store.publish(destination, bytes, new AbortController().signal)).resolves.toEqual({
      status: "created",
      contentHash: createSourceContentHash(bytes),
    });
    await expect(
      listTemporaryFiles(path.dirname(adapter.getFullPath(destination)))
    ).resolves.toEqual([]);
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("retains and reports a private orphan when bigint handle identity is unavailable", async () => {
    const adapter = await createAdapter();
    const baseRuntime = loadTestRuntime();
    const numberOnlyRuntime: KnowledgeFolderImportNodeRuntime = {
      ...baseRuntime,
      fs: {
        ...baseRuntime.fs,
        /** Simulates a native handle without bigint stat support. */
        open: async (targetPath, flags, mode) => {
          const handle = await baseRuntime.fs.open(targetPath, flags, mode);
          if (flags !== "wx") return handle;
          return {
            /** Writes exact test bytes through the bound native handle. */
            writeFile: (data) => handle.writeFile(data),
            /** Reads exact test bytes through the bound native handle. */
            readFile: () => handle.readFile(),
            /** Rejects only the bigint identity overload. */
            stat: createHandleStatReader(
              () => handle.stat(),
              async () => {
                throw new Error("private unsupported bigint detail");
              }
            ),
            /** Flushes the exact private temporary. */
            sync: () => handle.sync(),
            /** Closes the bound native handle. */
            close: () => handle.close(),
          } satisfies KnowledgeFolderImportNodeFileHandle;
        },
      },
    };
    const store = createStore(adapter, () => numberOnlyRuntime);
    const destination = `${SOURCE_ROOT}/number-only/source.md`;
    const bytes = new Uint8Array([2, 4, 6]);

    await expect(store.publish(destination, bytes, new AbortController().signal)).resolves.toEqual({
      status: "created",
      contentHash: createSourceContentHash(bytes),
    });
    const temporaries = await listTemporaryFiles(path.dirname(adapter.getFullPath(destination)));
    expect(temporaries).toHaveLength(1);
    expect(logWarn).toHaveBeenCalledWith(
      "Knowledge folder import retained a private temporary because its original namespace could not be safely re-proved"
    );
    expect(JSON.stringify((logWarn as jest.Mock).mock.calls)).not.toContain(destination);
    expect(JSON.stringify((logWarn as jest.Mock).mock.calls)).not.toContain(temporaries[0]);
  });

  it("reports exact file and directory conflicts without overwriting either target", async () => {
    const adapter = await createAdapter();
    const store = createStore(adapter);
    const expected = new Uint8Array([1, 2, 3]);
    const existing = new Uint8Array([4, 5, 6]);
    const fileDestination = `${SOURCE_ROOT}/my_idea/conflict.md`;
    const directoryDestination = `${SOURCE_ROOT}/my_idea/folder.pdf`;
    await fs.mkdir(path.dirname(adapter.getFullPath(fileDestination)), { recursive: true });
    await fs.writeFile(adapter.getFullPath(fileDestination), existing);
    await fs.mkdir(adapter.getFullPath(directoryDestination));

    await expect(
      store.publish(fileDestination, expected, new AbortController().signal)
    ).resolves.toEqual({
      status: "conflict",
      contentHash: createSourceContentHash(expected),
      observedKind: "file",
      observedContentHash: createSourceContentHash(existing),
      observedByteLength: existing.byteLength,
    });
    await expect(
      store.publish(directoryDestination, expected, new AbortController().signal)
    ).resolves.toEqual({
      status: "conflict",
      contentHash: createSourceContentHash(expected),
      observedKind: "directory",
    });
    await expect(fs.readFile(adapter.getFullPath(fileDestination))).resolves.toEqual(
      Buffer.from(existing)
    );
    await expect(fs.stat(adapter.getFullPath(directoryDestination))).resolves.toMatchObject({});
  });

  it("lets one concurrent publication win and classifies an identical racing copy as reused", async () => {
    const adapter = await createAdapter();
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const destination = `${SOURCE_ROOT}/race/source.bin`;
    const first = createStore(adapter);
    const second = createStore(adapter);

    const results = await Promise.all([
      first.publish(destination, bytes, new AbortController().signal),
      second.publish(destination, bytes, new AbortController().signal),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["created", "reused"]);
    await expect(fs.readFile(adapter.getFullPath(destination))).resolves.toEqual(
      Buffer.from(bytes)
    );
    await expect(
      listTemporaryFiles(path.dirname(adapter.getFullPath(destination)))
    ).resolves.toEqual([]);
  });

  it("fails closed when the exact configured source root is missing", async () => {
    const adapter = await createAdapter(false);
    const store = createStore(adapter);
    const destination = `${SOURCE_ROOT}/my_idea/source.md`;

    await expect(
      store.publish(destination, new Uint8Array([1]), new AbortController().signal)
    ).rejects.toMatchObject({
      name: "KnowledgeFolderImportFileStoreError",
      code: "source_root_unavailable",
      message: "The selected knowledge file could not be copied into the Vault",
    });
    await expect(fs.stat(adapter.getFullPath(SOURCE_ROOT))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a differently cased actual source root before opening or publishing", async () => {
    const adapter = await createAdapter();
    const baseRuntime = loadTestRuntime();
    const requestedSourceRoot = adapter.getFullPath(SOURCE_ROOT);
    const actualSourceRoot = adapter.getFullPath("Sources/IMPORTED");
    await fs.rename(requestedSourceRoot, actualSourceRoot);
    let openCalls = 0;
    let writeCalls = 0;
    let linkCalls = 0;
    const caseInsensitiveRuntime: KnowledgeFolderImportNodeRuntime = {
      ...baseRuntime,
      fs: {
        ...baseRuntime.fs,
        /** Resolves the configured case variant to the actual source-root spelling. */
        realpath: (targetPath) =>
          targetPath === requestedSourceRoot
            ? Promise.resolve(actualSourceRoot)
            : baseRuntime.fs.realpath(targetPath),
        lstat: createAliasedLstat(baseRuntime.fs, requestedSourceRoot, actualSourceRoot),
        /** Counts any forbidden file-open boundary below the mismatched source root. */
        open: async (targetPath, flags, mode) => {
          openCalls += 1;
          const handle = await baseRuntime.fs.open(targetPath, flags, mode);
          return {
            /** Counts and forwards any forbidden exact-byte write. */
            writeFile: async (data) => {
              writeCalls += 1;
              await handle.writeFile(data);
            },
            /** Reads bytes through the bound native handle. */
            readFile: () => handle.readFile(),
            /** Reads number or bigint stat through the bound native handle. */
            stat: forwardHandleStat(handle),
            /** Flushes the bound native handle. */
            sync: () => handle.sync(),
            /** Closes the bound native handle. */
            close: () => handle.close(),
          } satisfies KnowledgeFolderImportNodeFileHandle;
        },
        /** Counts any forbidden publication below the mismatched source root. */
        link: async (existingPath, newPath) => {
          linkCalls += 1;
          await baseRuntime.fs.link(existingPath, newPath);
        },
      },
    };
    const store = createStore(adapter, () => caseInsensitiveRuntime);

    await expect(
      store.publish(
        `${SOURCE_ROOT}/my_idea/source.md`,
        new Uint8Array([1, 2, 3]),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "source_root_unavailable" });
    expect(openCalls).toBe(0);
    expect(writeCalls).toBe(0);
    expect(linkCalls).toBe(0);
    await expect(fs.readdir(actualSourceRoot)).resolves.toEqual([]);
    await expect(fs.stat(requestedSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a descendant symlink escape before writing outside the source root", async () => {
    const adapter = await createAdapter();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-folder-import-outside-"));
    temporaryDirectories.push(outside);
    await fs.symlink(outside, adapter.getFullPath(`${SOURCE_ROOT}/escape`), "dir");
    const store = createStore(adapter);

    await expect(
      store.publish(
        `${SOURCE_ROOT}/escape/private.md`,
        new TextEncoder().encode("private bytes"),
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      name: "KnowledgeFolderImportFileStoreError",
      code: "destination_unavailable",
    });
    await expect(fs.stat(path.join(outside, "private.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("re-proves the final parent after a concurrent junction-style namespace swap", async () => {
    const adapter = await createAdapter();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-folder-import-swap-"));
    temporaryDirectories.push(outside);
    const baseRuntime = loadTestRuntime();
    const parent = adapter.getFullPath(`${SOURCE_ROOT}/swap`);
    const movedParent = `${parent}.moved`;
    let swapped = false;
    const swappingRuntime: KnowledgeFolderImportNodeRuntime = {
      ...baseRuntime,
      fs: {
        ...baseRuntime.fs,
        /** Swaps the final parent immediately before the private temp is opened. */
        open: async (targetPath, flags, mode) => {
          if (flags === "wx" && !swapped) {
            swapped = true;
            await fs.rename(parent, movedParent);
            await fs.symlink(outside, parent, "dir");
          }
          return baseRuntime.fs.open(targetPath, flags, mode);
        },
      },
    };
    const store = createStore(adapter, () => swappingRuntime);
    const destination = `${SOURCE_ROOT}/swap/source.md`;

    await expect(
      store.publish(destination, new Uint8Array([1, 2, 3]), new AbortController().signal)
    ).rejects.toMatchObject({ code: "destination_unavailable" });
    expect(swapped).toBe(true);
    await expect(fs.readdir(outside)).resolves.toEqual([]);
    await expect(fs.stat(path.join(outside, "source.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.stat(path.join(movedParent, "source.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves an external file with a different bigint identity after parent replacement", async () => {
    const adapter = await createAdapter();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-folder-import-cleanup-"));
    temporaryDirectories.push(outside);
    const baseRuntime = loadTestRuntime();
    const parent = adapter.getFullPath(`${SOURCE_ROOT}/cleanup-swap`);
    const movedParent = `${parent}.moved`;
    const outsideSentinel = new Uint8Array([91, 92, 93]);
    let temporaryName: string | undefined;
    let swapped = false;
    const swappingRuntime: KnowledgeFolderImportNodeRuntime = {
      ...baseRuntime,
      fs: {
        ...baseRuntime.fs,
        /** Swaps the parent after the private temporary is closed but before link reproof. */
        open: async (targetPath, flags, mode) => {
          const handle = await baseRuntime.fs.open(targetPath, flags, mode);
          if (flags !== "wx") return handle;
          temporaryName = path.basename(targetPath);
          return {
            /** Writes exact test bytes through the bound native handle. */
            writeFile: (data) => handle.writeFile(data),
            /** Reads exact test bytes through the bound native handle. */
            readFile: () => handle.readFile(),
            /** Reads exact test stat data through the bound native handle. */
            stat: forwardHandleStat(handle),
            /** Flushes the exact private temporary. */
            sync: () => handle.sync(),
            /** Replaces the parent namespace immediately after the exact handle closes. */
            close: async () => {
              await handle.close();
              if (swapped) return;
              swapped = true;
              await fs.rename(parent, movedParent);
              await fs.symlink(outside, parent, "dir");
              if (!temporaryName) throw new Error("Expected a private temporary name");
              await fs.writeFile(path.join(outside, temporaryName), outsideSentinel);
            },
          } satisfies KnowledgeFolderImportNodeFileHandle;
        },
      },
    };
    const store = createStore(adapter, () => swappingRuntime);
    const destination = `${SOURCE_ROOT}/cleanup-swap/source.md`;
    const sourceBytes = new Uint8Array([1, 2, 3, 4]);

    await expect(
      store.publish(destination, sourceBytes, new AbortController().signal)
    ).rejects.toMatchObject({ code: "destination_unavailable" });
    expect(swapped).toBe(true);
    expect(temporaryName).toBeDefined();
    if (!temporaryName) throw new Error("Expected a private temporary name");
    await expect(fs.readFile(path.join(outside, temporaryName))).resolves.toEqual(
      Buffer.from(outsideSentinel)
    );
    await expect(fs.readFile(path.join(movedParent, temporaryName))).resolves.toEqual(
      Buffer.from(sourceBytes)
    );
    await expect(fs.stat(path.join(outside, "source.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(logWarn).toHaveBeenCalledWith(
      "Knowledge folder import retained a private temporary because its original namespace could not be safely re-proved"
    );
    expect(JSON.stringify((logWarn as jest.Mock).mock.calls)).not.toContain(outside);
    expect(JSON.stringify((logWarn as jest.Mock).mock.calls)).not.toContain(temporaryName);
  });

  it("aborts after fsync, removes the private temporary, and leaves no published target", async () => {
    const adapter = await createAdapter();
    const controller = new AbortController();
    const baseRuntime = loadTestRuntime();
    const abortingRuntime: KnowledgeFolderImportNodeRuntime = {
      ...baseRuntime,
      fs: {
        ...baseRuntime.fs,
        /** Wraps native handles so the exact test generation aborts after durable temp sync. */
        open: async (targetPath, flags, mode) => {
          const handle = await baseRuntime.fs.open(targetPath, flags, mode);
          if (flags !== "wx") return handle;
          return {
            /** Writes exact test bytes through the bound native handle. */
            writeFile: (data) => handle.writeFile(data),
            /** Reads exact test bytes through the bound native handle. */
            readFile: () => handle.readFile(),
            /** Reads exact test stat data through the bound native handle. */
            stat: forwardHandleStat(handle),
            /** Flushes exact bytes and revokes the caller before publication. */
            sync: async () => {
              await handle.sync();
              controller.abort();
            },
            /** Closes the bound native handle. */
            close: () => handle.close(),
          } satisfies KnowledgeFolderImportNodeFileHandle;
        },
      },
    };
    const store = createStore(adapter, () => abortingRuntime);
    const destination = `${SOURCE_ROOT}/abort/source.pdf`;

    await expect(
      store.publish(destination, new Uint8Array([1, 2, 3]), controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(fs.stat(adapter.getFullPath(destination))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      listTemporaryFiles(path.dirname(adapter.getFullPath(destination)))
    ).resolves.toEqual([]);
  });

  it("sanitizes publication failures and cleans the fully written temporary", async () => {
    const adapter = await createAdapter();
    const baseRuntime = loadTestRuntime();
    const failingRuntime: KnowledgeFolderImportNodeRuntime = {
      ...baseRuntime,
      fs: {
        ...baseRuntime.fs,
        /** Simulates one native link failure whose sensitive message must not escape. */
        link: async () => {
          throw new Error("D:\\secret\\personal-note.md");
        },
      },
    };
    const store = createStore(adapter, () => failingRuntime);
    const destination = `${SOURCE_ROOT}/failure/private.md`;

    const error = await store
      .publish(destination, new TextEncoder().encode("secret text"), new AbortController().signal)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(KnowledgeFolderImportFileStoreError);
    expect(error).toMatchObject({ code: "io_failure" });
    expect(String((error as Error).message)).not.toContain("secret");
    expect(String((error as Error).message)).not.toContain("private.md");
    await expect(fs.stat(adapter.getFullPath(destination))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      listTemporaryFiles(path.dirname(adapter.getFullPath(destination)))
    ).resolves.toEqual([]);
  });

  it("rejects invalid containment, stale authority, and non-filesystem adapters", async () => {
    const adapter = await createAdapter();
    const store = createStore(adapter);
    await expect(
      store.publish("Outside/source.md", new Uint8Array([1]), new AbortController().signal)
    ).rejects.toMatchObject({ code: "invalid_input" });

    let current = false;
    const staleStore = createStore(adapter, loadTestRuntime, () => current);
    await expect(
      staleStore.publish(
        `${SOURCE_ROOT}/stale/source.md`,
        new Uint8Array([1]),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    current = true;

    expect(
      () =>
        new ObsidianKnowledgeFolderImportFileStore(
          {} as never,
          SOURCE_ROOT,
          createGeneration(),
          loadTestRuntime
        )
    ).toThrow(KnowledgeFolderImportFileStoreError);
  });
});
