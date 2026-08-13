jest.mock("obsidian", () => {
  class TFile {
    /** Creates one fake loaded file with canonical Vault spelling. */
    constructor(public readonly path: string) {}
  }

  class TFolder {
    /** Creates one fake loaded folder with canonical Vault spelling. */
    constructor(public readonly path: string) {}
  }

  return { TFile, TFolder };
});

import { TFile, TFolder, type App, type DataAdapter, type Vault } from "obsidian";

import type { CompilerTargetRequest } from "@/knowledge/compiler/CompilerModelPort";
import {
  ObsidianKnowledgeCompilerTargetResolver,
  ObsidianKnowledgeCompilerTargetResolverError,
  type ObsidianKnowledgeCompilerTargetResolverErrorCode,
} from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { ObsidianKnowledgeOutputObservationReader } from "@/knowledge/ingest/ObsidianKnowledgeOutputObservationReader";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

/** Creates one fake TFile despite Obsidian's opaque public constructors. */
function createTestFile(path: string): TFile {
  const Constructor = TFile as unknown as new (value: string) => TFile;
  return new Constructor(path);
}

/** Creates one fake TFolder despite Obsidian's opaque public constructors. */
function createTestFolder(path: string): TFolder {
  const Constructor = TFolder as unknown as new (value: string) => TFolder;
  return new Constructor(path);
}

/** Creates one exact compiler target request. */
function createRequest(
  path: string,
  access: CompilerTargetRequest["access"] = "authorized",
  targetId = "target-1"
): CompilerTargetRequest {
  return { targetId, path, intent: "write", access };
}

/** In-memory App/Vault boundary with inspectable index, stat, and content reads. */
class ResolverHarness {
  loaded: Array<TFile | TFolder> = [];
  readonly contents = new Map<string, string>();
  readonly fileStats = new Map<string, { ctime: number; mtime: number; size: number }>();
  readonly directories = new Set<string>();
  onStat?: (path: string) => void;
  onRead?: (path: string) => void;

  readonly stat = jest.fn(async (path: string) => {
    this.onStat?.(path);
    if (this.directories.has(path)) {
      return { type: "folder" as const, ctime: 0, mtime: 0, size: 0 };
    }
    const content = this.contents.get(path);
    const stat = this.fileStats.get(path);
    return content === undefined
      ? null
      : {
          type: "file" as const,
          ctime: stat?.ctime ?? 0,
          mtime: stat?.mtime ?? 0,
          size: stat?.size ?? new TextEncoder().encode(content).byteLength,
        };
  });

  readonly read = jest.fn(async (path: string) => {
    this.onRead?.(path);
    const content = this.contents.get(path);
    if (content === undefined) throw new Error("test adapter content unavailable");
    return content;
  });

  readonly getAllLoadedFiles = jest.fn(() => [...this.loaded]);

  readonly adapter = {
    stat: this.stat,
    read: this.read,
  } as unknown as DataAdapter;

  readonly vault = {
    adapter: this.adapter,
    getAllLoadedFiles: this.getAllLoadedFiles,
  } as unknown as Vault;

  readonly appOwner: { vault: Vault } = { vault: this.vault };

  /** Returns the exact mutable App owner used by the resolver lifecycle. */
  get app(): App {
    return this.appOwner as unknown as App;
  }

  /** Creates a resolver after the harness's exact owner methods are installed. */
  createResolver(): ObsidianKnowledgeCompilerTargetResolver {
    return new ObsidianKnowledgeCompilerTargetResolver(this.app);
  }

  /** Installs one canonical loaded file and its exact text bytes. */
  addFile(path: string, content: string): TFile {
    const file = createTestFile(path);
    this.loaded.push(file);
    this.contents.set(path, content);
    this.fileStats.set(path, {
      ctime: 1,
      mtime: 1,
      size: new TextEncoder().encode(content).byteLength,
    });
    return file;
  }

  /** Installs one canonical loaded folder and matching adapter stat state. */
  addFolder(path: string): TFolder {
    const folder = createTestFolder(path);
    this.loaded.push(folder);
    this.directories.add(path);
    return folder;
  }
}

/** Requires one rejected resolver promise to contain exactly the expected safe code. */
async function expectResolverCode(
  promise: Promise<unknown>,
  code: ObsidianKnowledgeCompilerTargetResolverErrorCode
): Promise<ObsidianKnowledgeCompilerTargetResolverError> {
  try {
    await promise;
  } catch (error) {
    expect(ObsidianKnowledgeCompilerTargetResolverError.inspect(error)).toBe(code);
    expect(error).toBeInstanceOf(ObsidianKnowledgeCompilerTargetResolverError);
    return error as ObsidianKnowledgeCompilerTargetResolverError;
  }
  throw new Error("Expected the target resolver to reject");
}

describe("ObsidianKnowledgeCompilerTargetResolver", () => {
  it("returns the exact Windows key for a missing target", async () => {
    const harness = new ResolverHarness();
    const resolver = harness.createResolver();

    await expect(
      resolver.resolve([createRequest("Wiki/Missing.md")], new AbortController().signal)
    ).resolves.toEqual([
      {
        targetId: "target-1",
        kind: "missing",
        windowsPathKey: toWindowsPathKey("Wiki/Missing.md"),
      },
    ]);
    expect(harness.stat).toHaveBeenCalledTimes(1);
    expect(harness.read).not.toHaveBeenCalled();
  });

  it("reports a case-insensitive create-only collision as occupied without reading content", async () => {
    const harness = new ResolverHarness();
    const secret = "private existing Wiki bytes";
    harness.addFile("Wiki/Private.md", secret);
    const resolver = harness.createResolver();

    const result = await resolver.resolve(
      [createRequest("wiki/PRIVATE.md", "create_only")],
      new AbortController().signal
    );

    expect(result).toEqual([{ targetId: "target-1", kind: "occupied", path: "Wiki/Private.md" }]);
    expect(harness.stat).not.toHaveBeenCalled();
    expect(harness.read).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("reads an authorized case alias only through its exact canonical Vault path", async () => {
    const harness = new ResolverHarness();
    const content = "# 标题\r\nexact 🦌 bytes  \r\n";
    harness.addFile("Wiki/Canonical.md", content);
    const resolver = harness.createResolver();

    await expect(
      resolver.resolve([createRequest("wiki/CANONICAL.md")], new AbortController().signal)
    ).resolves.toEqual([
      {
        targetId: "target-1",
        kind: "file",
        path: "Wiki/Canonical.md",
        content,
      },
    ]);
    expect(harness.read).toHaveBeenCalledTimes(1);
    expect(harness.read).toHaveBeenCalledWith("Wiki/Canonical.md");
    expect(harness.stat).toHaveBeenNthCalledWith(1, "Wiki/Canonical.md");
    expect(harness.stat).toHaveBeenNthCalledWith(2, "Wiki/Canonical.md");
  });

  it("rejects an oversized freshness file from stat before any content read", async () => {
    const harness = new ResolverHarness();
    harness.addFile("Wiki/Large.md", "1234");
    const reader = new ObsidianKnowledgeOutputObservationReader(harness.createResolver(), {
      maxBytesPerOutput: 3,
    });

    await expect(
      reader.observe(
        [{ path: "Wiki/Large.md", contentHash: "a".repeat(64) }],
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "output_too_large" });

    expect(harness.stat).toHaveBeenCalledTimes(1);
    expect(harness.read).not.toHaveBeenCalled();
  });

  it("enforces a smaller aggregate byte cap before the first content read", async () => {
    const harness = new ResolverHarness();
    harness.addFile("Wiki/Large.md", "1234");
    const reader = new ObsidianKnowledgeOutputObservationReader(harness.createResolver(), {
      maxBytesPerOutput: 10,
      maxTotalBytes: 3,
    });

    await expect(
      reader.observe(
        [{ path: "Wiki/Large.md", contentHash: "a".repeat(64) }],
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "output_too_large" });

    expect(harness.stat).toHaveBeenCalledTimes(1);
    expect(harness.read).not.toHaveBeenCalled();
  });

  it("stops aggregate freshness reads immediately without reading later outputs", async () => {
    const harness = new ResolverHarness();
    harness.addFile("Wiki/A.md", "123");
    harness.addFile("Wiki/B.md", "456");
    harness.addFile("Wiki/C.md", "789");
    const reader = new ObsidianKnowledgeOutputObservationReader(harness.createResolver(), {
      maxBytesPerOutput: 3,
      maxTotalBytes: 5,
    });

    await expect(
      reader.observe(
        [
          { path: "Wiki/A.md", contentHash: "a".repeat(64) },
          { path: "Wiki/B.md", contentHash: "b".repeat(64) },
          { path: "Wiki/C.md", contentHash: "c".repeat(64) },
        ],
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "output_too_large" });

    expect(harness.read.mock.calls).toEqual([["Wiki/A.md"], ["Wiki/B.md"]]);
    expect(harness.stat.mock.calls).toEqual([
      ["Wiki/A.md"],
      ["Wiki/A.md"],
      ["Wiki/B.md"],
      ["Wiki/B.md"],
    ]);
  });

  it("rejects size, mtime, or ctime drift across one bounded content read", async () => {
    for (const field of ["size", "mtime", "ctime"] as const) {
      const harness = new ResolverHarness();
      harness.addFile("Wiki/Drift.md", "123");
      harness.onRead = (path) => {
        const current = harness.fileStats.get(path);
        if (!current) throw new Error("missing test stat");
        harness.fileStats.set(path, { ...current, [field]: current[field] + 1 });
      };
      const visitor = jest.fn();

      await expectResolverCode(
        harness
          .createResolver()
          .visit(
            [createRequest("Wiki/Drift.md")],
            new AbortController().signal,
            { maxFileBytes: 10 },
            visitor
          ),
        "state_changed"
      );

      expect(harness.read).toHaveBeenCalledTimes(1);
      expect(visitor).not.toHaveBeenCalled();
    }
  });

  it("aborts bounded visitation before reading a later file", async () => {
    const harness = new ResolverHarness();
    harness.addFile("Wiki/A.md", "first");
    harness.addFile("Wiki/B.md", "second");
    const controller = new AbortController();
    harness.onRead = () => controller.abort("private cancellation material");

    const error = await expectResolverCode(
      harness
        .createResolver()
        .visit(
          [createRequest("Wiki/A.md", "authorized", "target-a"), createRequest("Wiki/B.md")],
          controller.signal,
          { maxFileBytes: 10 },
          jest.fn()
        ),
      "aborted"
    );

    expect(error.message).not.toContain("private cancellation material");
    expect(harness.read.mock.calls).toEqual([["Wiki/A.md"]]);
  });

  it("uses one initial and one final loaded index for a successful bounded batch", async () => {
    const harness = new ResolverHarness();
    harness.addFile("Wiki/A.md", "first");
    harness.addFile("Wiki/B.md", "second");
    const visited: string[] = [];

    await harness
      .createResolver()
      .visit(
        [
          createRequest("Wiki/A.md", "authorized", "target-a"),
          createRequest("Wiki/B.md", "authorized", "target-b"),
        ],
        new AbortController().signal,
        { maxFileBytes: 10 },
        (observation) => {
          visited.push(observation.targetId);
        }
      );

    expect(visited).toEqual(["target-a", "target-b"]);
    expect(harness.getAllLoadedFiles).toHaveBeenCalledTimes(2);
    expect(harness.read).toHaveBeenCalledTimes(2);
  });

  it("reports folders without reading and hides their kind from create-only requests", async () => {
    const harness = new ResolverHarness();
    harness.addFolder("Wiki/Folder.md");
    const resolver = harness.createResolver();

    await expect(
      resolver.resolve([createRequest("wiki/FOLDER.md")], new AbortController().signal)
    ).resolves.toEqual([{ targetId: "target-1", kind: "directory", path: "Wiki/Folder.md" }]);
    expect(harness.read).not.toHaveBeenCalled();

    harness.stat.mockClear();
    await expect(
      resolver.resolve(
        [createRequest("wiki/FOLDER.md", "create_only")],
        new AbortController().signal
      )
    ).resolves.toEqual([{ targetId: "target-1", kind: "occupied", path: "Wiki/Folder.md" }]);
    expect(harness.stat).not.toHaveBeenCalled();
    expect(harness.read).not.toHaveBeenCalled();
  });

  it("rejects a Windows-path collision without exposing either canonical spelling", async () => {
    const harness = new ResolverHarness();
    harness.addFile("Wiki/Page.md", "first private content");
    harness.addFile("wiki/PAGE.md", "second private content");
    const resolver = harness.createResolver();

    const error = await expectResolverCode(
      resolver.resolve([createRequest("Wiki/Page.md")], new AbortController().signal),
      "windows_collision"
    );

    expect(error.message).toBe("The Obsidian knowledge compiler target resolver failed");
    expect(error.message).not.toContain("Wiki/Page.md");
    expect(error.message).not.toContain("private content");
    expect(harness.read).not.toHaveBeenCalled();
  });

  it("rejects accessor and extra-field request payloads without invoking the accessor", async () => {
    const harness = new ResolverHarness();
    const resolver = harness.createResolver();
    let getterCalls = 0;
    const accessor = {
      targetId: "target-1",
      get path() {
        getterCalls += 1;
        return "Wiki/Page.md";
      },
      intent: "write",
      access: "authorized",
    } as unknown as CompilerTargetRequest;

    await expectResolverCode(
      resolver.resolve([accessor], new AbortController().signal),
      "request_invalid"
    );
    expect(getterCalls).toBe(0);
    expect(harness.getAllLoadedFiles).not.toHaveBeenCalled();

    await expectResolverCode(
      resolver.resolve(
        [{ ...createRequest("Wiki/Page.md"), unexpected: true } as CompilerTargetRequest],
        new AbortController().signal
      ),
      "request_invalid"
    );
  });

  it("rejects a canonical loaded-node replacement that races an authorized read", async () => {
    const harness = new ResolverHarness();
    const secret = "private bytes returned before index drift";
    harness.addFile("Wiki/Page.md", secret);
    harness.onRead = () => {
      harness.loaded = [createTestFile("Wiki/Page.md")];
    };
    const resolver = harness.createResolver();

    const error = await expectResolverCode(
      resolver.resolve([createRequest("Wiki/Page.md")], new AbortController().signal),
      "state_changed"
    );

    expect(error.message).not.toContain("Wiki/Page.md");
    expect(error.message).not.toContain(secret);
  });

  it("rejects an absent-index target that appears during the adapter probe without reading it", async () => {
    const harness = new ResolverHarness();
    const secret = "late private bytes";
    harness.onStat = (path) => {
      if (!harness.contents.has(path)) {
        harness.addFile(path, secret);
      }
    };
    const resolver = harness.createResolver();

    const error = await expectResolverCode(
      resolver.resolve(
        [createRequest("Wiki/Late.md", "create_only")],
        new AbortController().signal
      ),
      "state_changed"
    );

    expect(harness.read).not.toHaveBeenCalled();
    expect(error.message).not.toContain(secret);
  });

  it("sanitizes cancellation before and during exact content reads", async () => {
    const beforeHarness = new ResolverHarness();
    beforeHarness.addFile("Wiki/Page.md", "secret-before");
    const beforeResolver = beforeHarness.createResolver();
    const beforeController = new AbortController();
    beforeController.abort("private cancellation reason");

    const beforeError = await expectResolverCode(
      beforeResolver.resolve([createRequest("Wiki/Page.md")], beforeController.signal),
      "aborted"
    );
    expect(beforeError.name).toBe("AbortError");
    expect(beforeError.message).not.toContain("private cancellation reason");
    expect(beforeHarness.read).not.toHaveBeenCalled();

    const duringHarness = new ResolverHarness();
    duringHarness.addFile("Wiki/Page.md", "secret-during");
    const duringResolver = duringHarness.createResolver();
    const duringController = new AbortController();
    duringHarness.onRead = () => duringController.abort("private provider reason");
    const duringError = await expectResolverCode(
      duringResolver.resolve([createRequest("Wiki/Page.md")], duringController.signal),
      "aborted"
    );
    expect(duringError.name).toBe("AbortError");
    expect(duringError.message).not.toContain("private provider reason");
    expect(duringError.message).not.toContain("secret-during");
  });

  it("fails closed when the captured App no longer owns the same Vault", async () => {
    const harness = new ResolverHarness();
    const resolver = harness.createResolver();
    harness.appOwner.vault = {
      adapter: harness.adapter,
      getAllLoadedFiles: harness.getAllLoadedFiles,
    } as unknown as Vault;

    await expectResolverCode(
      resolver.resolve([createRequest("Wiki/Page.md")], new AbortController().signal),
      "owner_changed"
    );
    expect(harness.getAllLoadedFiles).not.toHaveBeenCalled();
    expect(harness.read).not.toHaveBeenCalled();
  });

  it("asserts only exact genuine resolvers and rejects every wrapper or forged shape", () => {
    const harness = new ResolverHarness();
    const resolver = harness.createResolver();
    class ResolverSubclass extends ObsidianKnowledgeCompilerTargetResolver {}
    const ownShadow = Object.create(ObsidianKnowledgeCompilerTargetResolver.prototype) as object;
    Object.defineProperty(ownShadow, "visit", {
      value: resolver.visit,
      enumerable: true,
    });

    expect(() => ObsidianKnowledgeCompilerTargetResolver.assert(resolver)).not.toThrow();
    for (const value of [
      {
        visit: (): Promise<void> => Promise.resolve(),
        resolve: (): Promise<unknown> => Promise.resolve([]),
      },
      Object.create(ObsidianKnowledgeCompilerTargetResolver.prototype),
      new ResolverSubclass(harness.app),
      new Proxy(resolver, {}),
      ownShadow,
    ]) {
      try {
        ObsidianKnowledgeCompilerTargetResolver.assert(value);
        throw new Error("Expected a forged target resolver to be rejected");
      } catch (error) {
        expect(ObsidianKnowledgeCompilerTargetResolverError.inspect(error)).toBe(
          "dependency_invalid"
        );
      }
    }
  });

  it("binds an optional production resolver to one exact App/Vault execution owner", () => {
    const harness = new ResolverHarness();
    const owner = createKnowledgeExecutionOwner();
    const alternateOwner = createKnowledgeExecutionOwner();
    const resolver = new ObsidianKnowledgeCompilerTargetResolver(harness.app, owner);

    expect(ObsidianKnowledgeCompilerTargetResolver.matchesExecutionOwner(resolver, owner)).toBe(
      true
    );
    expect(
      ObsidianKnowledgeCompilerTargetResolver.matchesExecutionOwner(resolver, alternateOwner)
    ).toBe(false);
    expect(
      ObsidianKnowledgeCompilerTargetResolver.matchesExecutionOwner(harness.createResolver(), owner)
    ).toBe(false);
    expect(
      ObsidianKnowledgeCompilerTargetResolver.matchesExecutionOwner(new Proxy(resolver, {}), owner)
    ).toBe(false);

    const otherHarness = new ResolverHarness();
    expect(() => new ObsidianKnowledgeCompilerTargetResolver(otherHarness.app, owner)).toThrow();

    harness.appOwner.vault = otherHarness.vault;
    expect(ObsidianKnowledgeCompilerTargetResolver.matchesExecutionOwner(resolver, owner)).toBe(
      false
    );
  });
});
