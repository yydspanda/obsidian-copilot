import type { DataAdapter } from "obsidian";
import { FileSystemAdapter, normalizePath } from "obsidian";

import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  loadObsidianNodeRuntimeModules,
  type ObsidianNodeFileHandle,
  type ObsidianNodeRuntimeLoader,
} from "@/knowledge/runtime/ObsidianNodeRuntime";

export class ObsidianAtomicRuntimeFileUnsupportedError extends Error {
  constructor() {
    super("The current Vault adapter cannot host the Windows knowledge runtime store");
    this.name = "ObsidianAtomicRuntimeFileUnsupportedError";
  }
}

function hasNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function requireExactRuntimePath(path: string): string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new ObsidianAtomicRuntimeFileUnsupportedError();
  }
  const normalized = normalizePath(path);
  if (normalized !== path) {
    throw new ObsidianAtomicRuntimeFileUnsupportedError();
  }
  return normalized;
}

async function closeQuietly(handle: ObsidianNodeFileHandle | undefined): Promise<void> {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    return;
  }
}

export class ObsidianAtomicRuntimeFile implements AtomicRuntimeFile {
  private readonly path: string;
  private readonly adapter: FileSystemAdapter;
  private readonly loadNodeRuntime: ObsidianNodeRuntimeLoader;

  constructor(
    adapter: DataAdapter,
    path: string,
    loadNodeRuntime: ObsidianNodeRuntimeLoader = loadObsidianNodeRuntimeModules
  ) {
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new ObsidianAtomicRuntimeFileUnsupportedError();
    }
    this.adapter = adapter;
    this.path = requireExactRuntimePath(path);
    this.loadNodeRuntime = loadNodeRuntime;
  }

  async initialize(initialContent: string): Promise<void> {
    if (typeof initialContent !== "string" || initialContent.length === 0) {
      throw new TypeError("initialContent must be non-empty plaintext");
    }
    const { fs, path: pathModule, randomUUID } = this.loadNodeRuntime();
    const vaultRoot = await fs.realpath(this.adapter.getBasePath());
    const absolutePath = pathModule.resolve(vaultRoot, ...this.path.split("/"));
    const relativePath = pathModule.relative(vaultRoot, absolutePath);
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${pathModule.sep}`) ||
      pathModule.isAbsolute(relativePath)
    ) {
      throw new ObsidianAtomicRuntimeFileUnsupportedError();
    }

    let realParent: string;
    try {
      realParent = await fs.realpath(pathModule.dirname(absolutePath));
    } catch {
      throw new ObsidianAtomicRuntimeFileUnsupportedError();
    }
    const relativeParent = pathModule.relative(vaultRoot, realParent);
    if (
      relativeParent === ".." ||
      relativeParent.startsWith(`..${pathModule.sep}`) ||
      pathModule.isAbsolute(relativeParent)
    ) {
      throw new ObsidianAtomicRuntimeFileUnsupportedError();
    }

    const publishedPath = pathModule.join(realParent, pathModule.basename(absolutePath));
    const temporaryPath = pathModule.join(
      realParent,
      `.${pathModule.basename(absolutePath)}.${randomUUID()}.tmp`
    );
    let handle: ObsidianNodeFileHandle | undefined;
    try {
      handle = await fs.open(temporaryPath, "wx", 0o600);
      await handle.writeFile(initialContent, { encoding: "utf8" });
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await fs.link(temporaryPath, publishedPath);
      } catch (error) {
        if (!hasNodeErrorCode(error, "EEXIST")) {
          throw error;
        }
      }
    } finally {
      await closeQuietly(handle);
      try {
        await fs.unlink(temporaryPath);
      } catch (error) {
        if (!hasNodeErrorCode(error, "ENOENT")) {
          // A complete published runtime is authoritative; an orphaned private temporary file is safe to clean up on a later maintenance pass.
          // https://github.com/yydspanda/obsidian-copilot/issues/24
        }
      }
    }

    const realPublishedPath = await fs.realpath(publishedPath);
    const relativePublishedPath = pathModule.relative(vaultRoot, realPublishedPath);
    if (
      relativePublishedPath === ".." ||
      relativePublishedPath.startsWith(`..${pathModule.sep}`) ||
      pathModule.isAbsolute(relativePublishedPath)
    ) {
      throw new ObsidianAtomicRuntimeFileUnsupportedError();
    }

    await this.adapter.read(this.path);
  }

  read(): Promise<string> {
    return this.adapter.read(this.path);
  }

  process(transform: (currentContent: string) => string): Promise<string> {
    return this.adapter.process(this.path, transform);
  }
}
