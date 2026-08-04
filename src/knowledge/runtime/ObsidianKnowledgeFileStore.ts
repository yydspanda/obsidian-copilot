import type { DataAdapter, Vault } from "obsidian";
import { FileSystemAdapter, TFile } from "obsidian";

import type {
  KnowledgeFileCompareAndSwapResult,
  KnowledgeFileMutationCapabilities,
  KnowledgeFileObservation,
  KnowledgeFileStore,
} from "@/knowledge/changeset/ChangeSetValidator";
import type { TransactionFileState } from "@/knowledge/changeset/TransactionStorage";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";
import {
  loadObsidianNodeRuntimeModules,
  type ObsidianNodeFileHandle,
  type ObsidianNodeRuntimeLoader,
} from "@/knowledge/runtime/ObsidianNodeRuntime";

/** Explicit mutation capabilities of the first Windows Vault file adapter. */
export const WINDOWS_KNOWLEDGE_FILE_MUTATION_CAPABILITIES: Readonly<KnowledgeFileMutationCapabilities> =
  Object.freeze({
    create: true,
    update: true,
    delete: false,
  });

/** Result of attempting to create one absent file with native exclusive semantics. */
export type ExclusiveKnowledgeFileCreateResult = "created" | "exists";

/** Native edge used only for atomic create-if-absent. */
export interface ExclusiveKnowledgeFileCreator {
  /**
   * Creates one UTF-8 file only if its exact path is absent.
   *
   * @param path - Validated Vault-relative file path
   * @param content - Exact journaled UTF-8 content
   * @returns Whether this call created the file or observed an existing path
   */
  create(path: string, content: string): Promise<ExclusiveKnowledgeFileCreateResult>;
}

/** Reports an operation the public Obsidian/Node boundary cannot make atomic. */
export class KnowledgeFileMutationUnsupportedError extends Error {
  /**
   * Creates a stable unsupported-operation error.
   *
   * @param operation - File mutation that must remain disabled
   */
  constructor(public readonly operation: "delete") {
    super(`Atomic knowledge file ${operation} is not available on this runtime`);
    this.name = "KnowledgeFileMutationUnsupportedError";
  }
}

/** Reports an invalid or unavailable parent directory for an exclusive create. */
export class KnowledgeFileParentUnavailableError extends Error {
  /** Creates a sanitized missing-parent error. */
  constructor() {
    super("The knowledge file parent directory is unavailable");
    this.name = "KnowledgeFileParentUnavailableError";
  }
}

/** Reports malformed success data returned by the Vault adapter boundary. */
export class KnowledgeFileAdapterPayloadError extends Error {
  /** Creates a stable adapter payload failure without retaining raw values. */
  constructor() {
    super("The Vault file adapter returned an invalid runtime payload");
    this.name = "KnowledgeFileAdapterPayloadError";
  }
}

/** Private control signal used to abort Vault.process without rewriting bytes. */
class KnowledgeFileProcessDecision extends Error {
  /**
   * Creates an atomic no-write process outcome.
   *
   * @param result - Already-after or exact conflicting observation
   */
  constructor(public readonly result: KnowledgeFileCompareAndSwapResult) {
    super("Knowledge file process completed without mutation");
    this.name = "KnowledgeFileProcessDecision";
  }
}

/** Reports whether an unknown Node rejection carries one stable code. */
function hasNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/** Closes a native file handle without masking an earlier failure. */
async function closeQuietly(handle: ObsidianNodeFileHandle | undefined): Promise<void> {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    return;
  }
}

/** Requires an exact canonical Windows-safe Vault-relative path. */
function requireVaultPath(path: string): string {
  const parsed = parseVaultPath(path);
  if (!parsed.ok || parsed.path !== path) {
    throw new TypeError("path must be an exact Windows-safe Vault-relative path");
  }
  return parsed.path;
}

/** Requires a file state to retain the exact hash of its embedded content. */
function assertFileState(state: TransactionFileState, field: string): void {
  if (state.kind === "file" && createFileContentHash(state.content) !== state.contentHash) {
    throw new TypeError(`${field}.contentHash must identify its exact content`);
  }
}

/** Compares one observation with a journaled file state using exact content. */
function observationMatchesState(
  observation: KnowledgeFileObservation,
  state: TransactionFileState
): boolean {
  return (
    (state.kind === "missing" && observation.kind === "missing") ||
    (state.kind === "file" && observation.kind === "file" && observation.content === state.content)
  );
}

/**
 * Native Windows exclusive creator scoped beneath one FileSystemAdapter root.
 *
 * It rejects missing parents and reparse/junction escapes rather than silently
 * creating unjournaled directory targets or writing outside the real Vault.
 */
export class WindowsExclusiveKnowledgeFileCreator implements ExclusiveKnowledgeFileCreator {
  private readonly adapter: FileSystemAdapter;
  private readonly loadNodeRuntime: ObsidianNodeRuntimeLoader;

  /**
   * Creates a native creator over one desktop filesystem adapter.
   *
   * @param adapter - Current Vault data adapter
   * @param loadNodeRuntime - Lazy desktop-native module loader
   */
  constructor(
    adapter: DataAdapter,
    loadNodeRuntime: ObsidianNodeRuntimeLoader = loadObsidianNodeRuntimeModules
  ) {
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new KnowledgeFileAdapterPayloadError();
    }
    this.adapter = adapter;
    this.loadNodeRuntime = loadNodeRuntime;
  }

  /** Publishes one fully written UTF-8 file without replacing an existing target. */
  async create(path: string, content: string): Promise<ExclusiveKnowledgeFileCreateResult> {
    const exactPath = requireVaultPath(path);
    const { fs, path: pathModule, randomUUID } = this.loadNodeRuntime();
    const vaultRoot = await fs.realpath(this.adapter.getBasePath());
    const absolutePath = this.adapter.getFullPath(exactPath);
    const parentPath = pathModule.dirname(absolutePath);
    let realParent: string;
    try {
      realParent = await fs.realpath(parentPath);
    } catch {
      throw new KnowledgeFileParentUnavailableError();
    }
    const relativeParent = pathModule.relative(vaultRoot, realParent);
    if (
      relativeParent === ".." ||
      relativeParent.startsWith(`..${pathModule.sep}`) ||
      pathModule.isAbsolute(relativeParent)
    ) {
      throw new KnowledgeFileParentUnavailableError();
    }

    const canonicalTarget = pathModule.join(realParent, pathModule.basename(absolutePath));
    const temporaryPath = pathModule.join(
      realParent,
      `.${pathModule.basename(absolutePath)}.${randomUUID()}.tmp`
    );
    let handle: ObsidianNodeFileHandle | undefined;
    let result: ExclusiveKnowledgeFileCreateResult = "created";
    try {
      handle = await fs.open(temporaryPath, "wx", 0o600);
      await handle.writeFile(content, { encoding: "utf8" });
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await fs.link(temporaryPath, canonicalTarget);
      } catch (error) {
        if (!hasNodeErrorCode(error, "EEXIST")) {
          throw error;
        }
        result = "exists";
      }
    } finally {
      await closeQuietly(handle);
      try {
        await fs.unlink(temporaryPath);
      } catch (error) {
        if (!hasNodeErrorCode(error, "ENOENT")) {
          // The published target is authoritative; private temp cleanup is best effort.
        }
      }
    }
    return result;
  }
}

/**
 * Exact Windows Vault file adapter for create/update knowledge mutations.
 *
 * Existing files use Vault.process so comparison and replacement are one
 * atomic Obsidian operation. New files use native exclusive create. Conditional
 * delete remains explicitly unsupported because neither public boundary offers
 * an atomic compare-and-delete primitive.
 */
export class ObsidianKnowledgeFileStore implements KnowledgeFileStore {
  readonly mutationCapabilities = WINDOWS_KNOWLEDGE_FILE_MUTATION_CAPABILITIES;
  private readonly creator: ExclusiveKnowledgeFileCreator;

  /**
   * Creates a file store over one Vault and optional testable create edge.
   *
   * @param vault - Current Obsidian Vault
   * @param creator - Optional exclusive creator; defaults to the Windows native edge
   */
  constructor(
    private readonly vault: Vault,
    creator?: ExclusiveKnowledgeFileCreator
  ) {
    this.creator = creator ?? new WindowsExclusiveKnowledgeFileCreator(vault.adapter);
  }

  /** Observes exact non-cached text, directory, or missing state. */
  async observe(path: string): Promise<KnowledgeFileObservation> {
    const exactPath = requireVaultPath(path);
    const stat = await this.vault.adapter.stat(exactPath);
    if (stat === null) {
      return { kind: "missing" };
    }
    if (
      typeof stat !== "object" ||
      stat === null ||
      (stat.type !== "file" && stat.type !== "folder")
    ) {
      throw new KnowledgeFileAdapterPayloadError();
    }
    if (stat.type === "folder") {
      return { kind: "directory" };
    }
    const content = await this.vault.adapter.read(exactPath);
    if (typeof content !== "string") {
      throw new KnowledgeFileAdapterPayloadError();
    }
    return { kind: "file", content };
  }

  /** Atomically creates or updates one exact state; delete always fails closed. */
  async compareAndSwap(
    path: string,
    before: TransactionFileState,
    after: TransactionFileState
  ): Promise<KnowledgeFileCompareAndSwapResult> {
    const exactPath = requireVaultPath(path);
    assertFileState(before, "before");
    assertFileState(after, "after");
    if (before.kind === "file" && after.kind === "missing") {
      const observation = await this.observe(exactPath);
      if (observation.kind === "missing") {
        return { kind: "already_after" };
      }
      if (!observationMatchesState(observation, before)) {
        return { kind: "conflict", observation };
      }
      throw new KnowledgeFileMutationUnsupportedError("delete");
    }
    if (before.kind === "missing" && after.kind === "file") {
      return this.createIfAbsent(exactPath, after);
    }
    if (before.kind === "file" && after.kind === "file") {
      return this.updateExisting(exactPath, before, after);
    }
    const observation = await this.observe(exactPath);
    return observationMatchesState(observation, after)
      ? { kind: "already_after" }
      : { kind: "conflict", observation };
  }

  /** Applies one exclusive missing-to-file transition. */
  private async createIfAbsent(
    path: string,
    after: Extract<TransactionFileState, { kind: "file" }>
  ): Promise<KnowledgeFileCompareAndSwapResult> {
    const initial = await this.observe(path);
    if (observationMatchesState(initial, after)) {
      return { kind: "already_after" };
    }
    if (initial.kind !== "missing") {
      return { kind: "conflict", observation: initial };
    }
    const result = await this.creator.create(path, after.content);
    const observation = await this.observe(path);
    if (observationMatchesState(observation, after)) {
      return { kind: result === "created" ? "applied" : "already_after" };
    }
    return { kind: "conflict", observation };
  }

  /** Applies one exact existing-file transition through Vault.process. */
  private async updateExisting(
    path: string,
    before: Extract<TransactionFileState, { kind: "file" }>,
    after: Extract<TransactionFileState, { kind: "file" }>
  ): Promise<KnowledgeFileCompareAndSwapResult> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      const observation = await this.observe(path);
      return observationMatchesState(observation, after)
        ? { kind: "already_after" }
        : { kind: "conflict", observation };
    }
    try {
      const written = await this.vault.process(file, (current) => {
        if (current === after.content) {
          throw new KnowledgeFileProcessDecision({ kind: "already_after" });
        }
        if (current !== before.content) {
          throw new KnowledgeFileProcessDecision({
            kind: "conflict",
            observation: { kind: "file", content: current },
          });
        }
        return after.content;
      });
      if (typeof written !== "string" || written !== after.content) {
        throw new KnowledgeFileAdapterPayloadError();
      }
    } catch (error) {
      if (error instanceof KnowledgeFileProcessDecision) {
        return error.result;
      }
      throw error;
    }
    const observation = await this.observe(path);
    return observationMatchesState(observation, after)
      ? { kind: "applied" }
      : { kind: "conflict", observation };
  }
}
