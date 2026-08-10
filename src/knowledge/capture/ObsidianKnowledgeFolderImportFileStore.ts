import type { DataAdapter } from "obsidian";
import { FileSystemAdapter } from "obsidian";

import { logWarn } from "@/logger";
import { createSourceContentHash, isExactUint8Array } from "@/knowledge/model/fingerprint";
import { isPathWithinRoot, parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { loadObsidianNodeRuntimeModules } from "@/knowledge/runtime/ObsidianNodeRuntime";

/** Durable outcomes of one exact-byte folder-import publication attempt. */
export type KnowledgeFolderImportFilePublishResult =
  | Readonly<{
      status: "created" | "reused";
      contentHash: string;
    }>
  | Readonly<{
      status: "conflict";
      contentHash: string;
      observedKind: "directory" | "file" | "unsupported";
      observedContentHash?: string;
      observedByteLength?: number;
    }>;

/** Stable failure categories that never retain a Vault path or source byte. */
export type KnowledgeFolderImportFileStoreErrorCode =
  | "unsupported_adapter"
  | "unsupported_runtime"
  | "invalid_input"
  | "source_root_unavailable"
  | "destination_unavailable"
  | "io_failure";

/** Sanitized failure raised by the Windows folder-import file boundary. */
export class KnowledgeFolderImportFileStoreError extends Error {
  /** Creates a path-free, byte-free file-store failure. */
  constructor(public readonly code: KnowledgeFolderImportFileStoreErrorCode) {
    super("The selected knowledge file could not be copied into the Vault");
    this.name = "KnowledgeFolderImportFileStoreError";
  }
}

/** Current production generation retained by one folder-import file store. */
export interface KnowledgeFolderImportFileStoreGenerationPort {
  /** Rejects synchronously when this exact production generation is stale. */
  assertCurrent(): void;
}

/** Minimum stat payload required to classify one native destination. */
export interface KnowledgeFolderImportNodeStat {
  readonly size: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink?(): boolean;
}

/** Bigint-only native identity returned without lossy Windows inode conversion. */
export interface KnowledgeFolderImportNodeIdentityStat {
  readonly dev: bigint;
  readonly ino: bigint;
}

/** Native file handle used by exact binary publication and observation. */
export interface KnowledgeFolderImportNodeFileHandle {
  writeFile(data: Uint8Array): Promise<void>;
  readFile(): Promise<Uint8Array>;
  stat(): Promise<KnowledgeFolderImportNodeStat>;
  stat(options: { bigint: true }): Promise<KnowledgeFolderImportNodeIdentityStat>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** Native filesystem promises required by the narrow folder-import boundary. */
export interface KnowledgeFolderImportNodeFileSystem {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<KnowledgeFolderImportNodeStat>;
  lstat(path: string, options: { bigint: true }): Promise<KnowledgeFolderImportNodeIdentityStat>;
  mkdir(path: string, options: { mode: number }): Promise<void>;
  open(
    path: string,
    flags: "wx" | "r",
    mode?: number
  ): Promise<KnowledgeFolderImportNodeFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

/** Native path operations required to contain every folder-import mutation. */
export interface KnowledgeFolderImportNodePath {
  readonly sep: string;
  resolve(...paths: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
  dirname(path: string): string;
  basename(path: string): string;
  join(...paths: string[]): string;
}

/** Validated native modules loaded only while one desktop import is active. */
export interface KnowledgeFolderImportNodeRuntime {
  readonly fs: KnowledgeFolderImportNodeFileSystem;
  readonly path: KnowledgeFolderImportNodePath;
  readonly randomUUID: () => string;
}

/** Lazily loads the exact native capabilities used by folder import. */
export type KnowledgeFolderImportNodeRuntimeLoader = () => KnowledgeFolderImportNodeRuntime;

interface AuthorizedFolderImportDestination {
  readonly fs: KnowledgeFolderImportNodeFileSystem;
  readonly path: KnowledgeFolderImportNodePath;
  readonly randomUUID: () => string;
  readonly realVaultRoot: string;
  readonly sourceRootPath: string;
  readonly realSourceRoot: string;
  readonly realParent: string;
  readonly targetPath: string;
}

interface ExistingFolderImportObservation {
  readonly kind: "directory" | "file" | "missing" | "unsupported";
  readonly bytes?: Uint8Array;
  readonly byteLength?: number;
  readonly contentHash?: string;
}

interface KnowledgeFolderImportNativeFileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

/** Creates the standard cancellation category for stale import authority. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Reports whether an unknown native rejection carries one stable Node code. */
function hasNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/** Recognizes cancellation across Obsidian popout and test DOM realms. */
function isAbortError(error: unknown): boolean {
  try {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "AbortError"
    );
  } catch {
    return false;
  }
}

/** Reports whether one native path is equal to or below a real root. */
function isNativePathWithinRoot(
  pathModule: KnowledgeFolderImportNodePath,
  candidate: string,
  root: string
): boolean {
  const relative = pathModule.relative(root, candidate);
  return (
    relative.length === 0 ||
    (relative !== ".." &&
      !relative.startsWith(`..${pathModule.sep}`) &&
      !pathModule.isAbsolute(relative))
  );
}

/** Reports whether a resolved native path retains the exact requested spelling. */
function hasExactNativePathSpelling(actualPath: string, expectedPath: string): boolean {
  return actualPath === expectedPath;
}

/** Requires a valid regular-file or directory stat without trusting exotic payloads. */
function classifyStat(stat: unknown): "directory" | "file" | "unsupported" {
  if (
    typeof stat !== "object" ||
    stat === null ||
    typeof (stat as KnowledgeFolderImportNodeStat).isDirectory !== "function" ||
    typeof (stat as KnowledgeFolderImportNodeStat).isFile !== "function"
  ) {
    throw new KnowledgeFolderImportFileStoreError("io_failure");
  }
  try {
    if ((stat as KnowledgeFolderImportNodeStat).isDirectory()) return "directory";
    if ((stat as KnowledgeFolderImportNodeStat).isFile()) return "file";
    return "unsupported";
  } catch {
    throw new KnowledgeFolderImportFileStoreError("io_failure");
  }
}

/** Reads a safe non-negative native byte length. */
function captureStatByteLength(stat: KnowledgeFolderImportNodeStat): number | undefined {
  try {
    return Number.isSafeInteger(stat.size) && stat.size >= 0 ? stat.size : undefined;
  } catch {
    return undefined;
  }
}

/** Captures a native file identity only when Node represents it without precision loss. */
function captureNativeFileIdentity(
  stat: KnowledgeFolderImportNodeIdentityStat
): KnowledgeFolderImportNativeFileIdentity | undefined {
  try {
    if (typeof stat.dev !== "bigint" || typeof stat.ino !== "bigint") {
      return undefined;
    }
    if (stat.dev < BigInt(0) || stat.ino <= BigInt(0)) {
      return undefined;
    }
    return Object.freeze({ device: stat.dev, inode: stat.ino });
  } catch {
    return undefined;
  }
}

/** Reports whether two captured native identities refer to the same exact inode. */
function haveSameNativeFileIdentity(
  left: KnowledgeFolderImportNativeFileIdentity,
  right: KnowledgeFolderImportNativeFileIdentity
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

/** Reads one exact bigint handle identity or reports unavailable native support. */
async function readHandleNativeFileIdentity(
  handle: KnowledgeFolderImportNodeFileHandle
): Promise<KnowledgeFolderImportNativeFileIdentity | undefined> {
  try {
    return captureNativeFileIdentity(await handle.stat({ bigint: true }));
  } catch {
    return undefined;
  }
}

/** Requires exact bytes and detaches them from a caller- or adapter-owned buffer. */
function captureBytes(value: unknown): Uint8Array {
  if (!isExactUint8Array(value)) {
    throw new KnowledgeFolderImportFileStoreError("invalid_input");
  }
  try {
    return Uint8Array.from(value);
  } catch {
    throw new KnowledgeFolderImportFileStoreError("invalid_input");
  }
}

/** Captures exact adapter bytes while classifying malformed native payloads as I/O failures. */
function captureAdapterBytes(value: unknown): Uint8Array {
  if (!isExactUint8Array(value)) {
    throw new KnowledgeFolderImportFileStoreError("io_failure");
  }
  try {
    return Uint8Array.from(value);
  } catch {
    throw new KnowledgeFolderImportFileStoreError("io_failure");
  }
}

/** Compares two detached byte arrays without accepting hash equality alone. */
function haveEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Closes a native file handle without masking the authoritative operation result. */
async function closeQuietly(
  handle: KnowledgeFolderImportNodeFileHandle | undefined
): Promise<void> {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    return;
  }
}

/** Records a possible private orphan without retaining its path, name, or source bytes. */
function reportPossibleTemporaryOrphan(): void {
  try {
    logWarn(
      "Knowledge folder import retained a private temporary because its original namespace could not be safely re-proved"
    );
  } catch {
    // Diagnostics must not replace the authoritative publication result.
  }
}

/** Validates the extra native methods carried by Node's real promises namespace. */
export function loadObsidianKnowledgeFolderImportNodeRuntime(): KnowledgeFolderImportNodeRuntime {
  let baseRuntime: ReturnType<typeof loadObsidianNodeRuntimeModules>;
  try {
    baseRuntime = loadObsidianNodeRuntimeModules();
  } catch {
    throw new KnowledgeFolderImportFileStoreError("unsupported_runtime");
  }
  const fs = baseRuntime.fs as unknown as Partial<KnowledgeFolderImportNodeFileSystem>;
  if (
    typeof fs.realpath !== "function" ||
    typeof fs.lstat !== "function" ||
    typeof fs.mkdir !== "function" ||
    typeof fs.open !== "function" ||
    typeof fs.link !== "function" ||
    typeof fs.unlink !== "function"
  ) {
    throw new KnowledgeFolderImportFileStoreError("unsupported_runtime");
  }
  return Object.freeze({
    fs: fs as KnowledgeFolderImportNodeFileSystem,
    path: baseRuntime.path,
    randomUUID: baseRuntime.randomUUID,
  });
}

/**
 * Windows desktop boundary for copying selected exact bytes beneath one source root.
 *
 * The configured source root must already exist. Descendant directories may be
 * created one at a time only after their real paths remain beneath that root.
 * Files publish through a fully written, synced temporary inode and one exclusive
 * hard link, so an existing file or directory is never overwritten.
 */
export class ObsidianKnowledgeFolderImportFileStore {
  private readonly adapter: FileSystemAdapter;
  private readonly sourceRoot: string;

  /**
   * Captures one exact source-root and production-generation authority.
   *
   * @param adapter - Current Windows desktop Vault adapter
   * @param sourceRoot - Existing, authorized Vault-relative source root
   * @param generation - Exact production generation that owns the import
   * @param loadNodeRuntime - Injectable lazy native boundary for deterministic tests
   */
  constructor(
    adapter: DataAdapter,
    sourceRoot: string,
    private readonly generation: KnowledgeFolderImportFileStoreGenerationPort,
    private readonly loadNodeRuntime: KnowledgeFolderImportNodeRuntimeLoader = loadObsidianKnowledgeFolderImportNodeRuntime
  ) {
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new KnowledgeFolderImportFileStoreError("unsupported_adapter");
    }
    const parsedRoot = parseVaultPath(sourceRoot);
    if (!parsedRoot.ok || parsedRoot.path !== sourceRoot) {
      throw new KnowledgeFolderImportFileStoreError("invalid_input");
    }
    this.adapter = adapter;
    this.sourceRoot = parsedRoot.path;
  }

  /** Ensures every missing destination parent beneath the exact existing source root. */
  async ensureParents(destinationPath: string, signal: AbortSignal): Promise<void> {
    const exactDestination = this.captureDestinationPath(destinationPath);
    try {
      await this.authorizeDestination(exactDestination, signal);
    } catch (error) {
      return this.rethrowSanitized(error);
    }
  }

  /** Creates, reuses, or reports a conflict for one exact binary destination. */
  async publish(
    destinationPath: string,
    bytes: Uint8Array,
    signal: AbortSignal
  ): Promise<KnowledgeFolderImportFilePublishResult> {
    const exactDestination = this.captureDestinationPath(destinationPath);
    const exactBytes = captureBytes(bytes);
    const contentHash = createSourceContentHash(exactBytes);
    let handle: KnowledgeFolderImportNodeFileHandle | undefined;
    let temporaryPath: string | undefined;
    let temporaryIdentity: KnowledgeFolderImportNativeFileIdentity | undefined;
    let destinationForCleanup: AuthorizedFolderImportDestination | undefined;
    let publishedByThisCall = false;
    try {
      const destination = await this.authorizeDestination(exactDestination, signal);
      destinationForCleanup = destination;
      await this.reproveDestinationNamespace(destination, signal);
      const existing = await this.observeExisting(destination, exactBytes.byteLength, signal);
      if (existing.kind !== "missing") {
        return this.classifyObservation(existing, exactBytes, contentHash);
      }

      this.assertCurrent(signal);
      await this.reproveDestinationNamespace(destination, signal);
      temporaryPath = destination.path.join(
        destination.realParent,
        `.${destination.path.basename(destination.targetPath)}.${destination.randomUUID()}.tmp`
      );
      handle = await destination.fs.open(temporaryPath, "wx", 0o600);
      this.assertCurrent(signal);
      const openedTemporaryStat = await handle.stat();
      this.assertCurrent(signal);
      if (classifyStat(openedTemporaryStat) !== "file") {
        throw new KnowledgeFolderImportFileStoreError("io_failure");
      }
      temporaryIdentity = await readHandleNativeFileIdentity(handle);
      this.assertCurrent(signal);
      await this.reproveDestinationNamespace(destination, signal);
      await handle.writeFile(exactBytes);
      this.assertCurrent(signal);
      await handle.sync();
      this.assertCurrent(signal);
      await handle.close();
      handle = undefined;
      this.assertCurrent(signal);
      await this.reproveDestinationNamespace(destination, signal);
      try {
        await destination.fs.link(temporaryPath, destination.targetPath);
        publishedByThisCall = true;
      } catch (error) {
        if (!hasNodeErrorCode(error, "EEXIST")) throw error;
      }
      this.assertCurrent(signal);
      await this.reproveDestinationNamespace(destination, signal);
      const published = await this.observeExisting(destination, exactBytes.byteLength, signal);
      if (published.kind === "missing") {
        throw new KnowledgeFolderImportFileStoreError("io_failure");
      }
      const result = this.classifyObservation(published, exactBytes, contentHash);
      return result.status === "reused" && publishedByThisCall
        ? Object.freeze({ status: "created", contentHash })
        : result;
    } catch (error) {
      return this.rethrowSanitized(error);
    } finally {
      await closeQuietly(handle);
      if (temporaryPath && temporaryIdentity && destinationForCleanup) {
        await this.cleanupTemporarySafely(destinationForCleanup, temporaryPath, temporaryIdentity);
      } else if (temporaryPath) {
        reportPossibleTemporaryOrphan();
      }
    }
  }

  /** Captures one exact Windows-safe destination nested strictly below the source root. */
  private captureDestinationPath(destinationPath: string): string {
    const parsed = parseVaultPath(destinationPath);
    if (
      !parsed.ok ||
      parsed.path !== destinationPath ||
      !isPathWithinRoot(parsed.path, this.sourceRoot) ||
      toWindowsPathKey(parsed.path) === toWindowsPathKey(this.sourceRoot)
    ) {
      throw new KnowledgeFolderImportFileStoreError("invalid_input");
    }
    return parsed.path;
  }

  /** Proves cancellation and the owning production generation together. */
  private assertCurrent(signal: AbortSignal): void {
    if (signal.aborted) throw createAbortError();
    try {
      this.generation.assertCurrent();
    } catch {
      throw createAbortError();
    }
    if (signal.aborted) throw createAbortError();
  }

  /** Resolves the real root and creates validated descendant parents one level at a time. */
  private async authorizeDestination(
    destinationPath: string,
    signal: AbortSignal
  ): Promise<AuthorizedFolderImportDestination> {
    this.assertCurrent(signal);
    let runtime: KnowledgeFolderImportNodeRuntime;
    try {
      runtime = this.loadNodeRuntime();
    } catch (error) {
      if (error instanceof KnowledgeFolderImportFileStoreError) throw error;
      throw new KnowledgeFolderImportFileStoreError("unsupported_runtime");
    }
    this.assertCurrent(signal);

    const { fs, path, randomUUID } = runtime;
    let realVaultRoot: string;
    let sourceRootPath: string;
    let realSourceRoot: string;
    try {
      realVaultRoot = await fs.realpath(this.adapter.getBasePath());
      this.assertCurrent(signal);
      sourceRootPath = path.resolve(realVaultRoot, ...this.sourceRoot.split("/"));
      if (!isNativePathWithinRoot(path, sourceRootPath, realVaultRoot)) {
        throw new KnowledgeFolderImportFileStoreError("source_root_unavailable");
      }
      const sourceRootLinkState = await fs.lstat(sourceRootPath);
      this.assertCurrent(signal);
      if (
        classifyStat(sourceRootLinkState) !== "directory" ||
        sourceRootLinkState.isSymbolicLink?.() === true
      ) {
        throw new KnowledgeFolderImportFileStoreError("source_root_unavailable");
      }
      realSourceRoot = await fs.realpath(sourceRootPath);
      this.assertCurrent(signal);
      if (!isNativePathWithinRoot(path, realSourceRoot, realVaultRoot)) {
        throw new KnowledgeFolderImportFileStoreError("source_root_unavailable");
      }
      if (!hasExactNativePathSpelling(realSourceRoot, sourceRootPath)) {
        throw new KnowledgeFolderImportFileStoreError("source_root_unavailable");
      }
    } catch (error) {
      if (error instanceof KnowledgeFolderImportFileStoreError) throw error;
      throw new KnowledgeFolderImportFileStoreError("source_root_unavailable");
    }

    const rootSegments = this.sourceRoot.split("/");
    const destinationSegments = destinationPath.split("/");
    const descendantSegments = destinationSegments.slice(rootSegments.length);
    const parentSegments = descendantSegments.slice(0, -1);
    let realParent = realSourceRoot;
    for (let index = 0; index < parentSegments.length; index += 1) {
      this.assertCurrent(signal);
      const candidate = path.join(realSourceRoot, ...parentSegments.slice(0, index + 1));
      if (!isNativePathWithinRoot(path, candidate, realSourceRoot)) {
        throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
      }
      try {
        await fs.mkdir(candidate, { mode: 0o700 });
      } catch (error) {
        if (!hasNodeErrorCode(error, "EEXIST")) {
          throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
        }
      }
      this.assertCurrent(signal);
      let linkState: KnowledgeFolderImportNodeStat;
      let realCandidate: string;
      try {
        linkState = await fs.lstat(candidate);
        this.assertCurrent(signal);
        if (classifyStat(linkState) !== "directory" || linkState.isSymbolicLink?.() === true) {
          throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
        }
        realCandidate = await fs.realpath(candidate);
        this.assertCurrent(signal);
      } catch (error) {
        if (error instanceof KnowledgeFolderImportFileStoreError) throw error;
        throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
      }
      if (!isNativePathWithinRoot(path, realCandidate, realSourceRoot)) {
        throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
      }
      if (!hasExactNativePathSpelling(realCandidate, candidate)) {
        throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
      }
      realParent = realCandidate;
    }

    const targetPath = path.join(realSourceRoot, ...descendantSegments);
    if (!isNativePathWithinRoot(path, targetPath, realSourceRoot)) {
      throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
    }
    return Object.freeze({
      fs,
      path,
      randomUUID,
      realVaultRoot,
      sourceRootPath,
      realSourceRoot,
      realParent,
      targetPath,
    });
  }

  /** Re-proves the exact root and final parent immediately around native publication. */
  private async reproveDestinationNamespace(
    destination: AuthorizedFolderImportDestination,
    signal: AbortSignal
  ): Promise<void> {
    this.assertCurrent(signal);
    try {
      const currentVaultRoot = await destination.fs.realpath(this.adapter.getBasePath());
      this.assertCurrent(signal);
      if (!hasExactNativePathSpelling(currentVaultRoot, destination.realVaultRoot)) {
        throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
      }

      const sourceLinkState = await destination.fs.lstat(destination.sourceRootPath);
      this.assertCurrent(signal);
      if (
        classifyStat(sourceLinkState) !== "directory" ||
        sourceLinkState.isSymbolicLink?.() === true
      ) {
        throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
      }
      const currentSourceRoot = await destination.fs.realpath(destination.sourceRootPath);
      this.assertCurrent(signal);
      if (!hasExactNativePathSpelling(currentSourceRoot, destination.realSourceRoot)) {
        throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
      }

      const parentLinkState = await destination.fs.lstat(destination.realParent);
      this.assertCurrent(signal);
      if (
        classifyStat(parentLinkState) !== "directory" ||
        parentLinkState.isSymbolicLink?.() === true
      ) {
        throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
      }
      const currentParent = await destination.fs.realpath(destination.realParent);
      this.assertCurrent(signal);
      if (!hasExactNativePathSpelling(currentParent, destination.realParent)) {
        throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
      }
    } catch (error) {
      if (error instanceof KnowledgeFolderImportFileStoreError || isAbortError(error)) throw error;
      throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
    }
  }

  /**
   * Removes only the exact native inode captured from the created private temporary.
   *
   * Node does not expose unlink-at-directory-handle semantics. If a replaced
   * namespace makes the old path missing or point at another inode, cleanup never
   * follows it and deliberately retains a possible private orphan instead.
   */
  private async cleanupTemporarySafely(
    destination: AuthorizedFolderImportDestination,
    temporaryPath: string,
    temporaryIdentity: KnowledgeFolderImportNativeFileIdentity
  ): Promise<void> {
    if (!this.isExactTemporaryPath(destination, temporaryPath)) {
      reportPossibleTemporaryOrphan();
      return;
    }
    const namespaceCurrent = await this.isCleanupNamespaceCurrent(destination);
    try {
      const candidateLinkState = await destination.fs.lstat(temporaryPath);
      if (
        classifyStat(candidateLinkState) !== "file" ||
        candidateLinkState.isSymbolicLink?.() === true
      ) {
        reportPossibleTemporaryOrphan();
        return;
      }
      let candidateIdentityStat: KnowledgeFolderImportNodeIdentityStat;
      try {
        candidateIdentityStat = await destination.fs.lstat(temporaryPath, { bigint: true });
      } catch {
        reportPossibleTemporaryOrphan();
        return;
      }
      const candidateIdentity = captureNativeFileIdentity(candidateIdentityStat);
      if (!candidateIdentity || !haveSameNativeFileIdentity(candidateIdentity, temporaryIdentity)) {
        reportPossibleTemporaryOrphan();
        return;
      }

      await destination.fs.unlink(temporaryPath);
    } catch (error) {
      if (!hasNodeErrorCode(error, "ENOENT") || !namespaceCurrent) {
        reportPossibleTemporaryOrphan();
      }
    }
  }

  /** Re-proves the captured root and parent without consulting cancelled generation state. */
  private async isCleanupNamespaceCurrent(
    destination: AuthorizedFolderImportDestination
  ): Promise<boolean> {
    try {
      const currentVaultRoot = await destination.fs.realpath(this.adapter.getBasePath());
      if (!hasExactNativePathSpelling(currentVaultRoot, destination.realVaultRoot)) {
        return false;
      }

      const sourceLinkState = await destination.fs.lstat(destination.sourceRootPath);
      if (
        classifyStat(sourceLinkState) !== "directory" ||
        sourceLinkState.isSymbolicLink?.() === true
      ) {
        return false;
      }
      const currentSourceRoot = await destination.fs.realpath(destination.sourceRootPath);
      if (!hasExactNativePathSpelling(currentSourceRoot, destination.realSourceRoot)) {
        return false;
      }

      const parentLinkState = await destination.fs.lstat(destination.realParent);
      if (
        classifyStat(parentLinkState) !== "directory" ||
        parentLinkState.isSymbolicLink?.() === true
      ) {
        return false;
      }
      const currentParent = await destination.fs.realpath(destination.realParent);
      return hasExactNativePathSpelling(currentParent, destination.realParent);
    } catch {
      return false;
    }
  }

  /** Proves that cleanup received the exact private path created for this destination. */
  private isExactTemporaryPath(
    destination: AuthorizedFolderImportDestination,
    temporaryPath: string
  ): boolean {
    try {
      return (
        hasExactNativePathSpelling(
          destination.path.dirname(temporaryPath),
          destination.realParent
        ) &&
        destination.path
          .basename(temporaryPath)
          .startsWith(`.${destination.path.basename(destination.targetPath)}.`) &&
        destination.path.basename(temporaryPath).endsWith(".tmp")
      );
    } catch {
      return false;
    }
  }

  /** Reads one existing target through a bound handle or reports exact absence. */
  private async observeExisting(
    destination: AuthorizedFolderImportDestination,
    expectedByteLength: number,
    signal: AbortSignal
  ): Promise<ExistingFolderImportObservation> {
    this.assertCurrent(signal);
    let linkState: KnowledgeFolderImportNodeStat;
    try {
      linkState = await destination.fs.lstat(destination.targetPath);
    } catch (error) {
      if (hasNodeErrorCode(error, "ENOENT")) return Object.freeze({ kind: "missing" });
      throw new KnowledgeFolderImportFileStoreError("io_failure");
    }
    this.assertCurrent(signal);
    let targetIsSymbolicLink: boolean;
    try {
      targetIsSymbolicLink = linkState.isSymbolicLink?.() === true;
    } catch {
      throw new KnowledgeFolderImportFileStoreError("io_failure");
    }
    if (targetIsSymbolicLink) {
      throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
    }
    const linkKind = classifyStat(linkState);
    if (linkKind !== "file") return Object.freeze({ kind: linkKind });

    let realTarget: string;
    try {
      realTarget = await destination.fs.realpath(destination.targetPath);
    } catch {
      throw new KnowledgeFolderImportFileStoreError("io_failure");
    }
    this.assertCurrent(signal);
    if (!hasExactNativePathSpelling(realTarget, destination.targetPath)) {
      throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
    }
    if (!isNativePathWithinRoot(destination.path, realTarget, destination.realSourceRoot)) {
      throw new KnowledgeFolderImportFileStoreError("destination_unavailable");
    }

    let handle: KnowledgeFolderImportNodeFileHandle | undefined;
    try {
      handle = await destination.fs.open(realTarget, "r");
      this.assertCurrent(signal);
      const stat = await handle.stat();
      this.assertCurrent(signal);
      const kind = classifyStat(stat);
      if (kind !== "file") return Object.freeze({ kind });
      const byteLength = captureStatByteLength(stat);
      if (byteLength === undefined) {
        throw new KnowledgeFolderImportFileStoreError("io_failure");
      }
      if (byteLength !== expectedByteLength) {
        return Object.freeze({ kind: "file", byteLength });
      }
      const bytes = captureAdapterBytes(await handle.readFile());
      this.assertCurrent(signal);
      return Object.freeze({
        kind: "file",
        bytes,
        byteLength: bytes.byteLength,
        contentHash: createSourceContentHash(bytes),
      });
    } catch (error) {
      if (error instanceof KnowledgeFolderImportFileStoreError || isAbortError(error)) {
        throw error;
      }
      throw new KnowledgeFolderImportFileStoreError("io_failure");
    } finally {
      await closeQuietly(handle);
    }
  }

  /** Converts an exact observation into a path-free create/reuse/conflict receipt. */
  private classifyObservation(
    observation: ExistingFolderImportObservation,
    expectedBytes: Uint8Array,
    contentHash: string
  ): KnowledgeFolderImportFilePublishResult {
    if (
      observation.kind === "file" &&
      observation.bytes &&
      haveEqualBytes(observation.bytes, expectedBytes)
    ) {
      return Object.freeze({ status: "reused", contentHash });
    }
    if (observation.kind === "missing") {
      throw new KnowledgeFolderImportFileStoreError("io_failure");
    }
    return Object.freeze({
      status: "conflict",
      contentHash,
      observedKind: observation.kind,
      ...(observation.contentHash === undefined
        ? {}
        : { observedContentHash: observation.contentHash }),
      ...(observation.byteLength === undefined
        ? {}
        : { observedByteLength: observation.byteLength }),
    });
  }

  /** Preserves only cancellation and this boundary's sanitized failures. */
  private rethrowSanitized(error: unknown): never {
    if (error instanceof KnowledgeFolderImportFileStoreError || isAbortError(error)) {
      throw error;
    }
    throw new KnowledgeFolderImportFileStoreError("io_failure");
  }
}
