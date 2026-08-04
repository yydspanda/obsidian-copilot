/** Minimum native file-handle surface needed by exclusive publication. */
export interface ObsidianNodeFileHandle {
  writeFile(data: string, options: { encoding: "utf8" }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** Native filesystem promises used by Windows knowledge persistence. */
export interface ObsidianNodeFileSystemPromises {
  realpath(path: string): Promise<string>;
  open(path: string, flags: "wx", mode: number): Promise<ObsidianNodeFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

/** Native path operations used to enforce real-Vault containment. */
export interface ObsidianNodePathModule {
  readonly sep: string;
  resolve(...paths: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
  dirname(path: string): string;
  basename(path: string): string;
  join(...paths: string[]): string;
}

/** Validated desktop-native modules needed by knowledge persistence. */
export interface ObsidianNodeRuntimeModules {
  readonly fs: ObsidianNodeFileSystemPromises;
  readonly path: ObsidianNodePathModule;
  readonly randomUUID: () => string;
}

/** Lazily resolves the desktop-native modules for one operation. */
export type ObsidianNodeRuntimeLoader = () => ObsidianNodeRuntimeModules;

/** Minimal CommonJS loader exposed by Obsidian's desktop Electron renderer. */
export type ObsidianNodeRequire = (moduleId: string) => unknown;

/** Reports that the current renderer cannot provide the required native modules. */
export class ObsidianNodeRuntimeUnavailableError extends Error {
  /** Creates a sanitized native-runtime availability error. */
  constructor() {
    super("The current Obsidian runtime cannot provide Windows knowledge file persistence");
    this.name = "ObsidianNodeRuntimeUnavailableError";
  }
}

/** Reports whether a value is an object-like module namespace. */
function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/** Reads the renderer's lazy CommonJS loader without evaluating native modules at import time. */
function getRendererNodeRequire(): unknown {
  try {
    return (window as unknown as { require?: unknown }).require;
  } catch {
    return undefined;
  }
}

/**
 * Loads and validates the native modules exposed by Obsidian Desktop.
 *
 * Obsidian's Electron renderer supports lazy CommonJS `require`, while native
 * dynamic imports are treated as browser module fetches. Keeping this lookup
 * inside the operation also preserves normal plugin loading on non-desktop
 * platforms where Knowledge Studio is unavailable.
 *
 * @param nodeRequire - Injectable CommonJS loader for deterministic tests
 * @returns Validated native filesystem, path, and UUID operations
 */
export function loadObsidianNodeRuntimeModules(
  nodeRequire: unknown = getRendererNodeRequire()
): ObsidianNodeRuntimeModules {
  if (typeof nodeRequire !== "function") {
    throw new ObsidianNodeRuntimeUnavailableError();
  }

  let fileSystemModule: unknown;
  let pathModule: unknown;
  let cryptoModule: unknown;
  try {
    const requireModule = nodeRequire as ObsidianNodeRequire;
    fileSystemModule = requireModule("node:fs");
    pathModule = requireModule("node:path");
    cryptoModule = requireModule("node:crypto");
  } catch {
    throw new ObsidianNodeRuntimeUnavailableError();
  }

  try {
    if (
      !isObjectLike(fileSystemModule) ||
      !isObjectLike(pathModule) ||
      !isObjectLike(cryptoModule)
    ) {
      throw new ObsidianNodeRuntimeUnavailableError();
    }
    const fileSystemPromises = fileSystemModule.promises;
    const randomUUID = cryptoModule.randomUUID;
    if (
      !isObjectLike(fileSystemPromises) ||
      typeof fileSystemPromises.realpath !== "function" ||
      typeof fileSystemPromises.open !== "function" ||
      typeof fileSystemPromises.link !== "function" ||
      typeof fileSystemPromises.unlink !== "function" ||
      typeof pathModule.sep !== "string" ||
      typeof pathModule.resolve !== "function" ||
      typeof pathModule.relative !== "function" ||
      typeof pathModule.isAbsolute !== "function" ||
      typeof pathModule.dirname !== "function" ||
      typeof pathModule.basename !== "function" ||
      typeof pathModule.join !== "function" ||
      typeof randomUUID !== "function"
    ) {
      throw new ObsidianNodeRuntimeUnavailableError();
    }

    return Object.freeze({
      fs: fileSystemPromises as unknown as ObsidianNodeFileSystemPromises,
      path: pathModule as unknown as ObsidianNodePathModule,
      randomUUID: () => {
        try {
          const value: unknown = Reflect.apply(randomUUID, cryptoModule, []);
          if (typeof value !== "string" || value.length === 0) {
            throw new ObsidianNodeRuntimeUnavailableError();
          }
          return value;
        } catch {
          throw new ObsidianNodeRuntimeUnavailableError();
        }
      },
    });
  } catch {
    throw new ObsidianNodeRuntimeUnavailableError();
  }
}
