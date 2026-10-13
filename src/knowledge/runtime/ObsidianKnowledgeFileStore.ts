import type { DataAdapter, Vault } from "obsidian";
import { FileSystemAdapter, TFile } from "obsidian";

import type {
  KnowledgeFileCompareAndSwapResult,
  KnowledgeFileMutationCapabilities,
  KnowledgeFileObservation,
  KnowledgeFileStore,
} from "@/knowledge/changeset/ChangeSetValidator";
import type { TransactionFileState } from "@/knowledge/changeset/TransactionStorage";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";
import {
  loadObsidianNodeRuntimeModules,
  type ObsidianNodeFileHandle,
  type ObsidianNodeRuntimeLoader,
} from "@/knowledge/runtime/ObsidianNodeRuntime";

export const WINDOWS_KNOWLEDGE_FILE_MUTATION_CAPABILITIES: Readonly<KnowledgeFileMutationCapabilities> =
  Object.freeze({
    create: true,
    update: true,
    delete: false,
    requiresExistingParentForCreate: true,
  });

export type ExclusiveKnowledgeFileCreateResult = "created" | "exists";

export interface ExclusiveKnowledgeFileCreator {
  create(path: string, content: string): Promise<ExclusiveKnowledgeFileCreateResult>;
}

export interface KnowledgeFileObservationLimits {
  readonly maxBytes: number;
  readonly maxCharacters: number;
}

interface ObsidianKnowledgeFileStoreState {
  readonly vault: Vault;
  readonly adapter: DataAdapter;
  readonly creator: ExclusiveKnowledgeFileCreator;
  readonly app?: object;
  readonly executionOwner?: KnowledgeExecutionOwner;
}

const obsidianKnowledgeFileStoreStates = new WeakMap<object, ObsidianKnowledgeFileStoreState>();

function requireObsidianKnowledgeFileStoreState(value: unknown): ObsidianKnowledgeFileStoreState {
  let prototype: object | null;
  try {
    prototype = typeof value === "object" && value !== null ? Object.getPrototypeOf(value) : null;
  } catch {
    throw new TypeError("The Obsidian knowledge file store is invalid");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    prototype !== ObsidianKnowledgeFileStore.prototype
  ) {
    throw new TypeError("The Obsidian knowledge file store is invalid");
  }
  const state = obsidianKnowledgeFileStoreStates.get(value);
  if (!state) throw new TypeError("The Obsidian knowledge file store is invalid");
  return state;
}

export class KnowledgeFileMutationUnsupportedError extends Error {
  constructor(public readonly operation: "delete") {
    super(`Atomic knowledge file ${operation} is not available on this runtime`);
    this.name = "KnowledgeFileMutationUnsupportedError";
  }
}

export class KnowledgeFileParentUnavailableError extends Error {
  constructor() {
    super("The knowledge file parent directory is unavailable");
    this.name = "KnowledgeFileParentUnavailableError";
  }
}

export class KnowledgeFileAdapterPayloadError extends Error {
  constructor() {
    super("The Vault file adapter returned an invalid runtime payload");
    this.name = "KnowledgeFileAdapterPayloadError";
  }
}

const observationLimitErrors = new WeakSet<object>();

export class KnowledgeFileObservationLimitError extends Error {
  constructor() {
    super("The knowledge file exceeds the bounded observation limit");
    this.name = "KnowledgeFileObservationLimitError";
    observationLimitErrors.add(this);
    Object.freeze(this);
  }

  static inspect(value: unknown): boolean {
    return (
      (typeof value === "object" || typeof value === "function") &&
      value !== null &&
      observationLimitErrors.has(value)
    );
  }
}

Object.freeze(KnowledgeFileObservationLimitError.prototype);
Object.freeze(KnowledgeFileObservationLimitError);

class KnowledgeFileProcessDecision extends Error {
  constructor(public readonly result: KnowledgeFileCompareAndSwapResult) {
    super("Knowledge file process completed without mutation");
    this.name = "KnowledgeFileProcessDecision";
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

async function closeQuietly(handle: ObsidianNodeFileHandle | undefined): Promise<void> {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    return;
  }
}

function requireVaultPath(path: string): string {
  const parsed = parseVaultPath(path);
  if (!parsed.ok || parsed.path !== path) {
    throw new TypeError("path must be an exact Windows-safe Vault-relative path");
  }
  return parsed.path;
}

function assertFileState(state: TransactionFileState, field: string): void {
  if (state.kind === "file" && createFileContentHash(state.content) !== state.contentHash) {
    throw new TypeError(`${field}.contentHash must identify its exact content`);
  }
}

function observationMatchesState(
  observation: KnowledgeFileObservation,
  state: TransactionFileState
): boolean {
  return (
    (state.kind === "missing" && observation.kind === "missing") ||
    (state.kind === "file" && observation.kind === "file" && observation.content === state.content)
  );
}

export class WindowsExclusiveKnowledgeFileCreator implements ExclusiveKnowledgeFileCreator {
  private readonly adapter: FileSystemAdapter;
  private readonly loadNodeRuntime: ObsidianNodeRuntimeLoader;

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
          // https://github.com/yydspanda/obsidian-copilot/issues/24
        }
      }
    }
    return result;
  }
}

export class ObsidianKnowledgeFileStore implements KnowledgeFileStore {
  readonly mutationCapabilities = WINDOWS_KNOWLEDGE_FILE_MUTATION_CAPABILITIES;
  private readonly creator: ExclusiveKnowledgeFileCreator;

  constructor(
    private readonly vault: Vault,
    creator?: ExclusiveKnowledgeFileCreator
  ) {
    this.creator = creator ?? new WindowsExclusiveKnowledgeFileCreator(vault.adapter);
    obsidianKnowledgeFileStoreStates.set(
      this,
      Object.freeze({ vault: this.vault, adapter: vault.adapter, creator: this.creator })
    );
  }

  static createForExecutionOwner(
    app: object,
    vault: Vault,
    executionOwner: KnowledgeExecutionOwner,
    creator?: ExclusiveKnowledgeFileCreator
  ): ObsidianKnowledgeFileStore {
    KnowledgeExecutionOwner.assert(executionOwner);
    if (
      typeof app !== "object" ||
      app === null ||
      typeof vault !== "object" ||
      vault === null ||
      typeof vault.adapter !== "object" ||
      vault.adapter === null ||
      !KnowledgeExecutionOwner.matchesVaultLifecycle(executionOwner, app, vault, vault.adapter)
    ) {
      throw new TypeError("The Obsidian knowledge file store owner is invalid");
    }
    const store = new ObsidianKnowledgeFileStore(vault, creator);
    const state = requireObsidianKnowledgeFileStoreState(store);
    obsidianKnowledgeFileStoreStates.set(
      store,
      Object.freeze({
        vault: state.vault,
        adapter: state.adapter,
        creator: state.creator,
        app,
        executionOwner,
      })
    );
    Object.freeze(store);
    return store;
  }

  static assert(value: unknown): asserts value is ObsidianKnowledgeFileStore {
    requireObsidianKnowledgeFileStoreState(value);
  }

  static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
    try {
      KnowledgeExecutionOwner.assert(executionOwner);
      const state = requireObsidianKnowledgeFileStoreState(value);
      if (
        state.executionOwner !== executionOwner ||
        state.app === undefined ||
        (state.app as { vault?: unknown }).vault !== state.vault ||
        state.vault.adapter !== state.adapter ||
        !Object.isFrozen(value)
      ) {
        return false;
      }
      return KnowledgeExecutionOwner.matchesVaultLifecycle(
        executionOwner,
        state.app,
        state.vault,
        state.adapter
      );
    } catch {
      return false;
    }
  }

  static matchesVault(value: unknown, vault: unknown): boolean {
    try {
      const state = requireObsidianKnowledgeFileStoreState(value);
      if (state.vault !== vault || state.vault.adapter !== state.adapter) return false;
      return state.executionOwner === undefined
        ? true
        : ObsidianKnowledgeFileStore.matchesExecutionOwner(value, state.executionOwner);
    } catch {
      return false;
    }
  }

  async observe(path: string): Promise<KnowledgeFileObservation> {
    this.assertForwardOwnerCurrent();
    const exactPath = requireVaultPath(path);
    const stat = await this.vault.adapter.stat(exactPath);
    this.assertForwardOwnerCurrent();
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
    this.assertForwardOwnerCurrent();
    if (typeof content !== "string") {
      throw new KnowledgeFileAdapterPayloadError();
    }
    return { kind: "file", content };
  }

  async observeBounded(
    path: string,
    limitsValue: KnowledgeFileObservationLimits
  ): Promise<KnowledgeFileObservation> {
    this.assertForwardOwnerCurrent();
    const exactPath = requireVaultPath(path);
    let limits: Readonly<KnowledgeFileObservationLimits>;
    try {
      if (
        typeof limitsValue !== "object" ||
        limitsValue === null ||
        Array.isArray(limitsValue) ||
        (Object.getPrototypeOf(limitsValue) !== Object.prototype &&
          Object.getPrototypeOf(limitsValue) !== null) ||
        Reflect.ownKeys(limitsValue).length !== 2
      ) {
        throw new TypeError();
      }
      const maxBytes = Object.getOwnPropertyDescriptor(limitsValue, "maxBytes");
      const maxCharacters = Object.getOwnPropertyDescriptor(limitsValue, "maxCharacters");
      if (
        !maxBytes?.enumerable ||
        !("value" in maxBytes) ||
        !maxCharacters?.enumerable ||
        !("value" in maxCharacters) ||
        !Number.isSafeInteger(maxBytes.value) ||
        maxBytes.value <= 0 ||
        !Number.isSafeInteger(maxCharacters.value) ||
        maxCharacters.value <= 0
      ) {
        throw new TypeError();
      }
      limits = Object.freeze({
        maxBytes: Number(maxBytes.value),
        maxCharacters: Number(maxCharacters.value),
      });
    } catch {
      throw new TypeError("The bounded knowledge file observation limits are invalid");
    }
    const stat = await this.vault.adapter.stat(exactPath);
    this.assertForwardOwnerCurrent();
    if (stat === null) return { kind: "missing" };
    if (
      typeof stat !== "object" ||
      stat === null ||
      (stat.type !== "file" && stat.type !== "folder") ||
      !Number.isSafeInteger(stat.size) ||
      stat.size < 0
    ) {
      throw new KnowledgeFileAdapterPayloadError();
    }
    if (stat.type === "folder") return { kind: "directory" };
    if (stat.size > limits.maxBytes) throw new KnowledgeFileObservationLimitError();
    const content = await this.vault.adapter.read(exactPath);
    this.assertForwardOwnerCurrent();
    if (typeof content !== "string") throw new KnowledgeFileAdapterPayloadError();
    if (
      content.length > limits.maxCharacters ||
      new TextEncoder().encode(content).byteLength > limits.maxBytes
    ) {
      throw new KnowledgeFileObservationLimitError();
    }
    return { kind: "file", content };
  }

  async compareAndSwap(
    path: string,
    before: TransactionFileState,
    after: TransactionFileState
  ): Promise<KnowledgeFileCompareAndSwapResult> {
    this.assertForwardOwnerCurrent();
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
      const result = await this.createIfAbsent(exactPath, after);
      this.assertForwardOwnerCurrent();
      return result;
    }
    if (before.kind === "file" && after.kind === "file") {
      const result = await this.updateExisting(exactPath, before, after);
      this.assertForwardOwnerCurrent();
      return result;
    }
    const observation = await this.observe(exactPath);
    return observationMatchesState(observation, after)
      ? { kind: "already_after" }
      : { kind: "conflict", observation };
  }

  private assertForwardOwnerCurrent(): void {
    const state = requireObsidianKnowledgeFileStoreState(this);
    if (state.executionOwner === undefined) return;
    if (!ObsidianKnowledgeFileStore.matchesExecutionOwner(this, state.executionOwner)) {
      throw new TypeError("The Obsidian knowledge file store generation is no longer current");
    }
  }

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
    this.assertForwardOwnerCurrent();
    const result = await this.creator.create(path, after.content);
    this.assertForwardOwnerCurrent();
    const observation = await this.observe(path);
    if (observationMatchesState(observation, after)) {
      return { kind: result === "created" ? "applied" : "already_after" };
    }
    return { kind: "conflict", observation };
  }

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

    // Existing files can escape through a file symlink or parent junction just as creates can.
    // This precheck is not atomic against hostile filesystem namespace swaps.
    // https://github.com/yydspanda/obsidian-copilot/issues/11
    const adapter = this.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new KnowledgeFileAdapterPayloadError();
    const { fs, path: pathModule } = loadObsidianNodeRuntimeModules();
    const vaultRoot = await fs.realpath(adapter.getBasePath());
    this.assertForwardOwnerCurrent();
    let realTarget: string;
    try {
      realTarget = await fs.realpath(adapter.getFullPath(path));
    } catch {
      throw new KnowledgeFileParentUnavailableError();
    }
    this.assertForwardOwnerCurrent();
    const relativeTarget = pathModule.relative(vaultRoot, realTarget);
    if (
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${pathModule.sep}`) ||
      pathModule.isAbsolute(relativeTarget)
    ) {
      throw new KnowledgeFileParentUnavailableError();
    }
    // A rename while realpath was pending must not redirect the already-validated update.
    // https://github.com/yydspanda/obsidian-copilot/issues/11
    if (file.path !== path) throw new KnowledgeFileAdapterPayloadError();
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

Object.freeze(ObsidianKnowledgeFileStore.prototype);
Object.freeze(ObsidianKnowledgeFileStore);
