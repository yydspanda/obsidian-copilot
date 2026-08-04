import {
  loadObsidianNodeRuntimeModules,
  ObsidianNodeRuntimeUnavailableError,
} from "@/knowledge/runtime/ObsidianNodeRuntime";

/** Creates the smallest valid native module surfaces for loader tests. */
function createValidModules() {
  const handle = {
    writeFile: jest.fn(async () => undefined),
    sync: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return {
    fileSystem: {
      promises: {
        realpath: jest.fn(async (path: string) => path),
        open: jest.fn(async () => handle),
        link: jest.fn(async () => undefined),
        unlink: jest.fn(async () => undefined),
      },
    },
    path: {
      sep: "\\",
      resolve: jest.fn((...parts: string[]) => parts.join("\\")),
      relative: jest.fn(() => "relative"),
      isAbsolute: jest.fn(() => false),
      dirname: jest.fn((value: string) => value),
      basename: jest.fn((value: string) => value),
      join: jest.fn((...parts: string[]) => parts.join("\\")),
    },
    crypto: {
      randomUUID: jest.fn(() => "00000000-0000-4000-8000-000000000000"),
    },
  };
}

describe("loadObsidianNodeRuntimeModules", () => {
  it("uses Obsidian Desktop's renderer require only when the operation loads modules", () => {
    const modules = createValidModules();
    const runtimeWindow = window as unknown as { require?: unknown };
    const originalRequire = runtimeWindow.require;
    const nodeRequire = jest.fn((moduleId: string): unknown => {
      if (moduleId === "node:fs") return modules.fileSystem;
      if (moduleId === "node:path") return modules.path;
      return modules.crypto;
    });
    runtimeWindow.require = nodeRequire;

    try {
      const runtime = loadObsidianNodeRuntimeModules();

      expect(runtime.fs).toBe(modules.fileSystem.promises);
      expect(nodeRequire).toHaveBeenCalledTimes(3);
    } finally {
      runtimeWindow.require = originalRequire;
    }
  });

  it("lazily requires and validates the exact desktop-native modules", async () => {
    const modules = createValidModules();
    const nodeRequire = jest.fn((moduleId: string): unknown => {
      if (moduleId === "node:fs") return modules.fileSystem;
      if (moduleId === "node:path") return modules.path;
      if (moduleId === "node:crypto") return modules.crypto;
      throw new Error("Unexpected module");
    });

    const runtime = loadObsidianNodeRuntimeModules(nodeRequire);

    expect(nodeRequire.mock.calls).toEqual([["node:fs"], ["node:path"], ["node:crypto"]]);
    expect(runtime.fs).toBe(modules.fileSystem.promises);
    expect(runtime.path).toBe(modules.path);
    expect(runtime.randomUUID()).toBe("00000000-0000-4000-8000-000000000000");
    expect(Object.isFrozen(runtime)).toBe(true);
    await expect(runtime.fs.realpath("C:\\Vault")).resolves.toBe("C:\\Vault");
  });

  it("fails closed when the renderer loader is unavailable or rejects", () => {
    expect(() => loadObsidianNodeRuntimeModules(null)).toThrow(ObsidianNodeRuntimeUnavailableError);
    expect(() =>
      loadObsidianNodeRuntimeModules(() => {
        throw new Error("raw module failure");
      })
    ).toThrow(ObsidianNodeRuntimeUnavailableError);
  });

  it("sanitizes throwing module access and UUID execution", () => {
    const accessorModules = createValidModules();
    Object.defineProperty(accessorModules.fileSystem, "promises", {
      configurable: true,
      get: () => {
        throw new Error("raw module getter failure");
      },
    });
    expect(() =>
      loadObsidianNodeRuntimeModules((moduleId: string) => {
        if (moduleId === "node:fs") return accessorModules.fileSystem;
        if (moduleId === "node:path") return accessorModules.path;
        return accessorModules.crypto;
      })
    ).toThrow(ObsidianNodeRuntimeUnavailableError);

    const invocationModules = createValidModules();
    invocationModules.crypto.randomUUID.mockImplementation(() => {
      throw new Error("raw UUID failure");
    });
    const runtime = loadObsidianNodeRuntimeModules((moduleId: string) => {
      if (moduleId === "node:fs") return invocationModules.fileSystem;
      if (moduleId === "node:path") return invocationModules.path;
      return invocationModules.crypto;
    });
    expect(() => runtime.randomUUID()).toThrow(ObsidianNodeRuntimeUnavailableError);
  });

  it("sanitizes a thrown Proxy without inspecting its prototype", () => {
    const modules = createValidModules();
    const hostileThrownValue = new Proxy(new Error("hostile thrown value"), {
      getPrototypeOf: () => {
        throw new Error("raw prototype trap failure");
      },
    });
    Object.defineProperty(modules.fileSystem, "promises", {
      configurable: true,
      get: () => {
        throw hostileThrownValue;
      },
    });

    expect(() =>
      loadObsidianNodeRuntimeModules((moduleId: string) => {
        if (moduleId === "node:fs") return modules.fileSystem;
        if (moduleId === "node:path") return modules.path;
        return modules.crypto;
      })
    ).toThrow(ObsidianNodeRuntimeUnavailableError);
  });

  it.each([
    ["filesystem", { fileSystem: {} }],
    ["path", { path: { sep: "\\" } }],
    ["crypto", { crypto: {} }],
  ])("rejects an incomplete %s module surface", (_label, replacement) => {
    const modules = { ...createValidModules(), ...replacement };
    const nodeRequire = (moduleId: string): unknown => {
      if (moduleId === "node:fs") return modules.fileSystem;
      if (moduleId === "node:path") return modules.path;
      return modules.crypto;
    };

    expect(() => loadObsidianNodeRuntimeModules(nodeRequire)).toThrow(
      ObsidianNodeRuntimeUnavailableError
    );
  });
});
