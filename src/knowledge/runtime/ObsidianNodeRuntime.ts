export interface ObsidianNodeFileHandle {
  writeFile(data: string, options: { encoding: "utf8" }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface ObsidianNodeFileSystemPromises {
  realpath(path: string): Promise<string>;
  open(path: string, flags: "wx", mode: number): Promise<ObsidianNodeFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface ObsidianNodePathModule {
  readonly sep: string;
  resolve(...paths: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
  dirname(path: string): string;
  basename(path: string): string;
  join(...paths: string[]): string;
}

export interface ObsidianNodeRuntimeModules {
  readonly fs: ObsidianNodeFileSystemPromises;
  readonly path: ObsidianNodePathModule;
  readonly randomUUID: () => string;
}

export type ObsidianNodeRuntimeLoader = () => ObsidianNodeRuntimeModules;

export type ObsidianNodeRequire = (moduleId: string) => unknown;

export class ObsidianNodeRuntimeUnavailableError extends Error {
  constructor() {
    super("The current Obsidian runtime cannot provide Windows knowledge file persistence");
    this.name = "ObsidianNodeRuntimeUnavailableError";
  }
}

function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function getRendererNodeRequire(): unknown {
  try {
    return (window as unknown as { require?: unknown }).require;
  } catch {
    return undefined;
  }
}

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
