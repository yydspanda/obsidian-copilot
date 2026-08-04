import type { DataAdapter } from "obsidian";
import { FileSystemAdapter, normalizePath } from "obsidian";

import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  loadObsidianNodeRuntimeModules,
  type ObsidianNodeFileHandle,
  type ObsidianNodeRuntimeLoader,
} from "@/knowledge/runtime/ObsidianNodeRuntime";

/** Reports a runtime path or adapter that cannot satisfy Windows desktop requirements. */
export class ObsidianAtomicRuntimeFileUnsupportedError extends Error {
  /** Creates a sanitized unsupported-adapter error. */
  constructor() {
    super("The current Vault adapter cannot host the Windows knowledge runtime store");
    this.name = "ObsidianAtomicRuntimeFileUnsupportedError";
  }
}

/**
 * Reports whether an unknown Node rejection exposes one exact error code.
 *
 * @param error - Unknown filesystem rejection
 * @param code - Expected stable Node error code
 * @returns Whether the rejection carries the requested code
 */
function hasNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * Rejects paths that normalize, traverse, or leave room for native ambiguity.
 *
 * @param path - Candidate Vault-relative runtime file path
 * @returns Exact normalized path
 */
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

/**
 * Closes an initialization handle without masking the original failure.
 *
 * @param handle - Exclusive file handle, when creation reached that point
 */
async function closeQuietly(handle: ObsidianNodeFileHandle | undefined): Promise<void> {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    return;
  }
}

/**
 * Windows desktop implementation of one persistent atomic runtime file.
 *
 * Creation publishes a fully written temporary file through one exclusive
 * hard-link operation, so readers never observe a winning initializer's empty
 * or partial file. Subsequent mutations use Obsidian's DataAdapter.process
 * boundary over the permanently existing file. Its real Windows behavior and
 * crash characteristics remain an explicit product acceptance gate.
 *
 * Node modules are lazily required only when initialization runs, so the
 * surrounding non-desktop plugin does not evaluate a top-level Node import.
 */
export class ObsidianAtomicRuntimeFile implements AtomicRuntimeFile {
  private readonly path: string;
  private readonly adapter: FileSystemAdapter;
  private readonly loadNodeRuntime: ObsidianNodeRuntimeLoader;

  /**
   * Creates a Windows runtime file over an explicit Vault adapter and path.
   *
   * @param adapter - Current Vault data adapter
   * @param path - Vault-relative private runtime file path
   * @param loadNodeRuntime - Lazy desktop-native module loader
   */
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

  /** Publishes one completely written runtime file without replacing an existing one. */
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
          // A complete published runtime is authoritative; an orphaned private
          // temporary file is safe to clean up on a later maintenance pass.
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

    // Do not report readiness until complete bytes are observable through the
    // same adapter used by future serialized transforms.
    await this.adapter.read(this.path);
  }

  /** Reads exact non-cached runtime bytes through the Vault adapter. */
  read(): Promise<string> {
    return this.adapter.read(this.path);
  }

  /** Transforms the permanently initialized file through DataAdapter.process. */
  process(transform: (currentContent: string) => string): Promise<string> {
    return this.adapter.process(this.path, transform);
  }
}
