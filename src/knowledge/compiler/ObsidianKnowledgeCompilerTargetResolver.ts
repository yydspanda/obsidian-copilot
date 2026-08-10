import { TFile, TFolder, type App, type DataAdapter, type Vault } from "obsidian";

import type {
  CompilerTargetObservation,
  CompilerTargetRequest,
  CompilerTargetResolver,
} from "@/knowledge/compiler/CompilerModelPort";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const MAX_TARGET_REQUESTS = 10_000;
const MAX_LOADED_ENTRIES = 1_000_000;
const RESOLVER_ERROR_TOKEN = Symbol("ObsidianKnowledgeCompilerTargetResolverError.constructor");

/** Stable value-free failure categories for the production target read boundary. */
export type ObsidianKnowledgeCompilerTargetResolverErrorCode =
  | "dependency_invalid"
  | "request_invalid"
  | "owner_changed"
  | "index_invalid"
  | "windows_collision"
  | "state_changed"
  | "adapter_payload_invalid"
  | "resource_limit"
  | "vault_unavailable"
  | "aborted";

/** Read-before-content limits for one sequential target visit. */
export interface ObsidianKnowledgeCompilerTargetVisitOptions {
  maxFileBytes: number;
}

/** Callback that consumes one exact observation before the next target is read. */
export type ObsidianKnowledgeCompilerTargetVisitor = (
  observation: Readonly<CompilerTargetObservation>,
  fileByteSize: number | undefined
) => void | Promise<void>;

/** Bounded sequential read port used by production output freshness verification. */
export interface ObsidianKnowledgeCompilerTargetVisitPort {
  /**
   * Visits authorized targets one at a time without retaining prior file content.
   *
   * @param targets - Strict authorized target requests
   * @param signal - Cancellation signal for the captured workflow generation
   * @param options - Pre-read byte hard limit for every file
   * @param visitor - Consumer invoked and awaited before the next target read
   */
  visit(
    targets: readonly CompilerTargetRequest[],
    signal: AbortSignal,
    options: Readonly<ObsidianKnowledgeCompilerTargetVisitOptions>,
    visitor: ObsidianKnowledgeCompilerTargetVisitor
  ): Promise<void>;
}

const resolverErrorCodes = new WeakMap<object, ObsidianKnowledgeCompilerTargetResolverErrorCode>();

/** Creates one authentic sanitized resolver failure without retaining an input or cause. */
function createResolverError(
  code: ObsidianKnowledgeCompilerTargetResolverErrorCode
): ObsidianKnowledgeCompilerTargetResolverError {
  return new ObsidianKnowledgeCompilerTargetResolverError(RESOLVER_ERROR_TOKEN, code);
}

/** Sanitized target-resolution failure containing no path, file content, Vault error, or cause. */
export class ObsidianKnowledgeCompilerTargetResolverError extends Error {
  /** Creates an error only for this module's private failure factory. */
  constructor(token: symbol, code: ObsidianKnowledgeCompilerTargetResolverErrorCode) {
    super("The Obsidian knowledge compiler target resolver failed");
    if (token !== RESOLVER_ERROR_TOKEN) {
      throw new TypeError("The Obsidian knowledge compiler target resolver error is invalid");
    }
    this.name = code === "aborted" ? "AbortError" : "ObsidianKnowledgeCompilerTargetResolverError";
    resolverErrorCodes.set(this, code);
    Object.freeze(this);
  }

  /** Reads the stable code only from a module-minted resolver error. */
  static inspect(value: unknown): ObsidianKnowledgeCompilerTargetResolverErrorCode | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    return resolverErrorCodes.get(value);
  }

  /** Returns the stable value-free failure code retained in hidden module state. */
  get code(): ObsidianKnowledgeCompilerTargetResolverErrorCode {
    const code = ObsidianKnowledgeCompilerTargetResolverError.inspect(this);
    if (!code) {
      throw new TypeError("The Obsidian knowledge compiler target resolver error is invalid");
    }
    return code;
  }
}

interface CapturedResolverDependencies {
  app: App;
  vault: Vault;
  adapter: DataAdapter;
  getAllLoadedFiles: () => unknown;
  stat: (path: string) => Promise<unknown>;
  read: (path: string) => Promise<unknown>;
}

interface LoadedTargetEntry {
  node: TFile | TFolder;
  path: string;
  windowsPathKey: string;
  kind: "file" | "directory";
}

interface LoadedTargetIndex {
  byWindowsPathKey: ReadonlyMap<string, readonly LoadedTargetEntry[]>;
}

/** Strict adapter stat material retained only around one exact content read. */
interface AdapterStatSnapshot {
  type: "file" | "folder";
  ctime: number;
  mtime: number;
  size: number;
}

/** One sequentially resolved target and its optional pre-read byte size. */
interface VisitedTarget {
  observation: Readonly<CompilerTargetObservation>;
  fileByteSize?: number;
}

/** Private wrapper that keeps visitor failures separate from Vault failures. */
class TargetVisitorFailure extends Error {
  /** Captures one callback failure only until the public visit boundary rethrows it. */
  constructor(public readonly error: unknown) {
    super("The bounded target visitor failed");
    this.name = "TargetVisitorFailure";
  }
}

type UnknownDataMethod = (this: unknown, ...args: unknown[]) => unknown;

const resolverStates = new WeakMap<object, Readonly<CapturedResolverDependencies>>();

/** Compares text by code unit so target order never depends on the host locale. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Stops target work with a sanitized cancellation when the exact signal is aborted. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createResolverError("aborted");
}

/** Finds one callable data method without invoking an accessor on the owner chain. */
function findDataMethod(value: unknown, key: string): UnknownDataMethod | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return undefined;
  }
  try {
    let current: object | null = value;
    const visited = new Set<object>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        const candidate: unknown = "value" in descriptor ? descriptor.value : undefined;
        return typeof candidate === "function" ? (candidate as UnknownDataMethod) : undefined;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Captures one synchronous no-argument method with its exact receiver. */
function captureNoArgumentMethod(value: unknown, key: string): () => unknown {
  const method = findDataMethod(value, key);
  if (!method) throw createResolverError("dependency_invalid");
  return () => {
    const result: unknown = Reflect.apply(method, value, []);
    return result;
  };
}

/** Captures one asynchronous path method with its exact receiver. */
function capturePathMethod(value: unknown, key: string): (path: string) => Promise<unknown> {
  const method = findDataMethod(value, key);
  if (!method) throw createResolverError("dependency_invalid");
  return async (path: string) => {
    const result: unknown = Reflect.apply(method, value, [path]);
    return await Promise.resolve(result);
  };
}

/** Captures one exact App, Vault, adapter, and immutable method receiver set. */
function captureDependencies(app: App): Readonly<CapturedResolverDependencies> {
  try {
    if (typeof app !== "object" || app === null) {
      throw createResolverError("dependency_invalid");
    }
    const vault = app.vault;
    const adapter = vault?.adapter;
    if (
      typeof vault !== "object" ||
      vault === null ||
      typeof adapter !== "object" ||
      adapter === null
    ) {
      throw createResolverError("dependency_invalid");
    }
    return Object.freeze({
      app,
      vault,
      adapter,
      getAllLoadedFiles: captureNoArgumentMethod(vault, "getAllLoadedFiles"),
      stat: capturePathMethod(adapter, "stat"),
      read: capturePathMethod(adapter, "read"),
    });
  } catch (error) {
    if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
    throw createResolverError("dependency_invalid");
  }
}

/** Re-proves that the captured App still owns the same exact Vault and adapter. */
function assertOwnerCurrent(state: Readonly<CapturedResolverDependencies>): void {
  try {
    if (state.app.vault !== state.vault || state.vault.adapter !== state.adapter) {
      throw createResolverError("owner_changed");
    }
  } catch (error) {
    if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
    throw createResolverError("owner_changed");
  }
}

/** Reads one enumerable data property without evaluating an accessor. */
function readDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    throw createResolverError("request_invalid");
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw createResolverError("request_invalid");
    }
    return descriptor.value;
  } catch (error) {
    if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
    throw createResolverError("request_invalid");
  }
}

/** Checks an exact own string-key set without consulting property values. */
function hasExactOwnKeys(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const actual = Reflect.ownKeys(value);
    const sortedExpected = [...expected].sort(compareText);
    return (
      actual.length === sortedExpected.length &&
      actual.every((key) => typeof key === "string") &&
      actual.sort(compareText).every((key, index) => key === sortedExpected[index])
    );
  } catch {
    return false;
  }
}

/** Checks a canonical non-empty identifier without changing its identity. */
function isCanonicalIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

/** Strictly snapshots one compiler target request through data descriptors only. */
function snapshotTargetRequest(value: unknown): Readonly<CompilerTargetRequest> {
  if (!hasExactOwnKeys(value, ["targetId", "path", "intent", "access"])) {
    throw createResolverError("request_invalid");
  }
  const targetId = readDataProperty(value, "targetId");
  const path = readDataProperty(value, "path");
  const intent = readDataProperty(value, "intent");
  const access = readDataProperty(value, "access");
  const parsedPath = typeof path === "string" ? parseVaultPath(path) : undefined;
  if (
    !isCanonicalIdentifier(targetId) ||
    !parsedPath?.ok ||
    parsedPath.path !== path ||
    (intent !== "write" && intent !== "delete") ||
    (access !== "authorized" && access !== "create_only")
  ) {
    throw createResolverError("request_invalid");
  }
  return Object.freeze({ targetId, path: parsedPath.path, intent, access });
}

/** Strictly snapshots a bounded dense request array without iterator or accessor hooks. */
function snapshotTargetRequests(value: unknown): readonly Readonly<CompilerTargetRequest>[] {
  if (!Array.isArray(value)) throw createResolverError("request_invalid");
  let length: number;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !descriptor ||
      !("value" in descriptor) ||
      !Number.isSafeInteger(descriptor.value) ||
      descriptor.value < 0 ||
      descriptor.value > MAX_TARGET_REQUESTS ||
      Reflect.ownKeys(value).length !== descriptor.value + 1
    ) {
      throw createResolverError("request_invalid");
    }
    length = descriptor.value as number;
  } catch (error) {
    if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
    throw createResolverError("request_invalid");
  }

  const requests: Readonly<CompilerTargetRequest>[] = [];
  const targetIds = new Set<string>();
  const pathKeys = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    let item: unknown;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw createResolverError("request_invalid");
      }
      item = descriptor.value;
    } catch (error) {
      if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
      throw createResolverError("request_invalid");
    }
    const request = snapshotTargetRequest(item);
    const pathKey = toWindowsPathKey(request.path);
    if (targetIds.has(request.targetId) || pathKeys.has(pathKey)) {
      throw createResolverError("request_invalid");
    }
    targetIds.add(request.targetId);
    pathKeys.add(pathKey);
    requests.push(request);
  }
  return Object.freeze(requests);
}

/** Strictly snapshots the one bounded-visit resource option. */
function snapshotVisitOptions(
  value: unknown
): Readonly<ObsidianKnowledgeCompilerTargetVisitOptions> {
  if (!hasExactOwnKeys(value, ["maxFileBytes"])) {
    throw createResolverError("request_invalid");
  }
  const maxFileBytes = readDataProperty(value, "maxFileBytes");
  if (!Number.isSafeInteger(maxFileBytes) || (maxFileBytes as number) < 1) {
    throw createResolverError("request_invalid");
  }
  return Object.freeze({ maxFileBytes: maxFileBytes as number });
}

/** Reads a loaded node path as an own enumerable data property. */
function readLoadedPath(node: TFile | TFolder): string {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(node, "path");
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw createResolverError("index_invalid");
    }
    if (typeof descriptor.value !== "string") {
      throw createResolverError("index_invalid");
    }
    return descriptor.value;
  } catch (error) {
    if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
    throw createResolverError("index_invalid");
  }
}

/** Captures a bounded Windows-keyed index from the exact loaded Vault generation. */
function captureLoadedIndex(state: Readonly<CapturedResolverDependencies>): LoadedTargetIndex {
  assertOwnerCurrent(state);
  let raw: unknown;
  try {
    raw = state.getAllLoadedFiles();
  } catch {
    throw createResolverError("vault_unavailable");
  }
  if (!Array.isArray(raw)) throw createResolverError("index_invalid");
  let length: number;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(raw, "length");
    if (
      !descriptor ||
      !("value" in descriptor) ||
      !Number.isSafeInteger(descriptor.value) ||
      descriptor.value < 0 ||
      descriptor.value > MAX_LOADED_ENTRIES ||
      Reflect.ownKeys(raw).length !== descriptor.value + 1
    ) {
      throw createResolverError("index_invalid");
    }
    length = descriptor.value as number;
  } catch (error) {
    if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
    throw createResolverError("index_invalid");
  }

  const mutable = new Map<string, LoadedTargetEntry[]>();
  for (let index = 0; index < length; index += 1) {
    let node: unknown;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw createResolverError("index_invalid");
      }
      node = descriptor.value;
    } catch (error) {
      if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
      throw createResolverError("index_invalid");
    }
    if (!(node instanceof TFile) && !(node instanceof TFolder)) {
      throw createResolverError("index_invalid");
    }
    const path = readLoadedPath(node);
    if (node instanceof TFolder && (path === "" || path === "/")) continue;
    const parsed = parseVaultPath(path);
    if (!parsed.ok || parsed.path !== path) {
      throw createResolverError("index_invalid");
    }
    const windowsPathKey = toWindowsPathKey(path);
    const entry: LoadedTargetEntry = Object.freeze({
      node,
      path,
      windowsPathKey,
      kind: node instanceof TFile ? "file" : "directory",
    });
    const existing = mutable.get(windowsPathKey);
    if (existing) existing.push(entry);
    else mutable.set(windowsPathKey, [entry]);
  }
  const byWindowsPathKey = new Map<string, readonly LoadedTargetEntry[]>();
  for (const [key, entries] of mutable) {
    byWindowsPathKey.set(key, Object.freeze([...entries]));
  }
  assertOwnerCurrent(state);
  return Object.freeze({ byWindowsPathKey });
}

/** Returns one unambiguous loaded entry or a sanitized Windows-collision failure. */
function findLoadedEntry(
  index: LoadedTargetIndex,
  windowsPathKey: string
): LoadedTargetEntry | undefined {
  const entries = index.byWindowsPathKey.get(windowsPathKey);
  if (!entries || entries.length === 0) return undefined;
  if (entries.length !== 1) throw createResolverError("windows_collision");
  return entries[0];
}

/** Requires a post-I/O loaded index to retain the exact target node and canonical path. */
function assertLoadedEntryCurrent(
  state: Readonly<CapturedResolverDependencies>,
  expected: LoadedTargetEntry
): void {
  const current = findLoadedEntry(captureLoadedIndex(state), expected.windowsPathKey);
  if (
    !current ||
    current.node !== expected.node ||
    current.path !== expected.path ||
    current.kind !== expected.kind
  ) {
    throw createResolverError("state_changed");
  }
}

/** Reads one required non-negative safe-integer adapter stat field. */
function readAdapterStatInteger(value: unknown, key: "ctime" | "mtime" | "size"): number {
  if (typeof value !== "object" || value === null) {
    throw createResolverError("adapter_payload_invalid");
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !Number.isSafeInteger(descriptor.value) ||
      descriptor.value < 0
    ) {
      throw createResolverError("adapter_payload_invalid");
    }
    return descriptor.value as number;
  } catch (error) {
    if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
    throw createResolverError("adapter_payload_invalid");
  }
}

/** Strictly detaches required adapter stat fields while tolerating platform extensions. */
function snapshotAdapterStat(value: unknown): Readonly<AdapterStatSnapshot> | null {
  if (value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw createResolverError("adapter_payload_invalid");
  }
  let type: unknown;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "type");
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw createResolverError("adapter_payload_invalid");
    }
    type = descriptor.value;
  } catch (error) {
    if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
    throw createResolverError("adapter_payload_invalid");
  }
  if (type !== "file" && type !== "folder") {
    throw createResolverError("adapter_payload_invalid");
  }
  return Object.freeze({
    type,
    ctime: readAdapterStatInteger(value, "ctime"),
    mtime: readAdapterStatInteger(value, "mtime"),
    size: readAdapterStatInteger(value, "size"),
  });
}

/** Reads one full adapter stat snapshot under owner and cancellation checks. */
async function readStatSnapshot(
  state: Readonly<CapturedResolverDependencies>,
  path: string,
  signal: AbortSignal
): Promise<Readonly<AdapterStatSnapshot> | null> {
  throwIfAborted(signal);
  assertOwnerCurrent(state);
  let raw: unknown;
  try {
    raw = await state.stat(path);
  } catch {
    if (signal.aborted) throw createResolverError("aborted");
    throw createResolverError("vault_unavailable");
  }
  throwIfAborted(signal);
  assertOwnerCurrent(state);
  return snapshotAdapterStat(raw);
}

/** Reports whether two full stat snapshots describe the same exact file generation. */
function sameAdapterStat(
  left: Readonly<AdapterStatSnapshot>,
  right: Readonly<AdapterStatSnapshot>
): boolean {
  return (
    left.type === right.type &&
    left.ctime === right.ctime &&
    left.mtime === right.mtime &&
    left.size === right.size
  );
}

/** Re-proves every requested loaded identity with one final whole-Vault index. */
function assertBatchLoadedIndexCurrent(
  state: Readonly<CapturedResolverDependencies>,
  initial: LoadedTargetIndex,
  requests: readonly Readonly<CompilerTargetRequest>[]
): void {
  const current = captureLoadedIndex(state);
  for (const request of requests) {
    const pathKey = toWindowsPathKey(request.path);
    const before = findLoadedEntry(initial, pathKey);
    const after = findLoadedEntry(current, pathKey);
    if (
      before?.node !== after?.node ||
      before?.path !== after?.path ||
      before?.kind !== after?.kind
    ) {
      throw createResolverError("state_changed");
    }
  }
}

/** Reads and validates only the adapter stat discriminator needed by this boundary. */
async function readStatType(
  state: Readonly<CapturedResolverDependencies>,
  path: string,
  signal: AbortSignal
): Promise<"file" | "folder" | "missing"> {
  throwIfAborted(signal);
  assertOwnerCurrent(state);
  let raw: unknown;
  try {
    raw = await state.stat(path);
  } catch {
    if (signal.aborted) throw createResolverError("aborted");
    throw createResolverError("vault_unavailable");
  }
  throwIfAborted(signal);
  assertOwnerCurrent(state);
  if (raw === null) return "missing";
  if (typeof raw !== "object" || raw === null) {
    throw createResolverError("adapter_payload_invalid");
  }
  let type: unknown;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(raw, "type");
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw createResolverError("adapter_payload_invalid");
    }
    type = descriptor.value;
  } catch (error) {
    if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
    throw createResolverError("adapter_payload_invalid");
  }
  if (type !== "file" && type !== "folder") {
    throw createResolverError("adapter_payload_invalid");
  }
  return type;
}

/** Resolves one absent loaded key only after the adapter and a second index agree. */
async function resolveUnloadedTarget(
  state: Readonly<CapturedResolverDependencies>,
  request: Readonly<CompilerTargetRequest>,
  signal: AbortSignal
): Promise<CompilerTargetObservation> {
  const windowsPathKey = toWindowsPathKey(request.path);
  const type = await readStatType(state, request.path, signal);
  const current = findLoadedEntry(captureLoadedIndex(state), windowsPathKey);
  throwIfAborted(signal);
  if (type !== "missing" || current) {
    throw createResolverError("state_changed");
  }
  return Object.freeze({ targetId: request.targetId, kind: "missing", windowsPathKey });
}

/** Resolves one authorized loaded directory after adapter and index reproof. */
async function resolveAuthorizedDirectory(
  state: Readonly<CapturedResolverDependencies>,
  request: Readonly<CompilerTargetRequest>,
  entry: LoadedTargetEntry,
  signal: AbortSignal
): Promise<CompilerTargetObservation> {
  const type = await readStatType(state, entry.path, signal);
  if (type !== "folder") throw createResolverError("state_changed");
  assertLoadedEntryCurrent(state, entry);
  throwIfAborted(signal);
  return Object.freeze({ targetId: request.targetId, kind: "directory", path: entry.path });
}

/** Reads one authorized canonical file and rejects any index/stat owner drift around it. */
async function resolveAuthorizedFile(
  state: Readonly<CapturedResolverDependencies>,
  request: Readonly<CompilerTargetRequest>,
  entry: LoadedTargetEntry,
  signal: AbortSignal
): Promise<CompilerTargetObservation> {
  const beforeType = await readStatType(state, entry.path, signal);
  if (beforeType !== "file") throw createResolverError("state_changed");
  let content: unknown;
  try {
    content = await state.read(entry.path);
  } catch {
    if (signal.aborted) throw createResolverError("aborted");
    throw createResolverError("vault_unavailable");
  }
  throwIfAborted(signal);
  assertOwnerCurrent(state);
  if (typeof content !== "string") {
    throw createResolverError("adapter_payload_invalid");
  }
  const afterType = await readStatType(state, entry.path, signal);
  if (afterType !== "file") throw createResolverError("state_changed");
  assertLoadedEntryCurrent(state, entry);
  throwIfAborted(signal);
  return Object.freeze({
    targetId: request.targetId,
    kind: "file",
    path: entry.path,
    content,
  });
}

/** Resolves one strict request without disclosing content to a create-only target. */
async function resolveTarget(
  state: Readonly<CapturedResolverDependencies>,
  index: LoadedTargetIndex,
  request: Readonly<CompilerTargetRequest>,
  signal: AbortSignal
): Promise<CompilerTargetObservation> {
  throwIfAborted(signal);
  assertOwnerCurrent(state);
  const entry = findLoadedEntry(index, toWindowsPathKey(request.path));
  if (!entry) return resolveUnloadedTarget(state, request, signal);
  if (request.access === "create_only") {
    return Object.freeze({ targetId: request.targetId, kind: "occupied", path: entry.path });
  }
  if (entry.kind === "directory") {
    return resolveAuthorizedDirectory(state, request, entry, signal);
  }
  return resolveAuthorizedFile(state, request, entry, signal);
}

/** Resolves one target for sequential visitation without retaining prior content. */
async function resolveVisitedTarget(
  state: Readonly<CapturedResolverDependencies>,
  index: LoadedTargetIndex,
  request: Readonly<CompilerTargetRequest>,
  signal: AbortSignal,
  maxFileBytes: number
): Promise<Readonly<VisitedTarget>> {
  throwIfAborted(signal);
  assertOwnerCurrent(state);
  const windowsPathKey = toWindowsPathKey(request.path);
  const entry = findLoadedEntry(index, windowsPathKey);
  if (!entry) {
    const stat = await readStatSnapshot(state, request.path, signal);
    if (stat !== null) throw createResolverError("state_changed");
    return Object.freeze({
      observation: Object.freeze({
        targetId: request.targetId,
        kind: "missing" as const,
        windowsPathKey,
      }),
    });
  }
  if (request.access === "create_only") {
    return Object.freeze({
      observation: Object.freeze({
        targetId: request.targetId,
        kind: "occupied" as const,
        path: entry.path,
      }),
    });
  }
  if (entry.kind === "directory") {
    const stat = await readStatSnapshot(state, entry.path, signal);
    if (stat?.type !== "folder") throw createResolverError("state_changed");
    return Object.freeze({
      observation: Object.freeze({
        targetId: request.targetId,
        kind: "directory" as const,
        path: entry.path,
      }),
    });
  }

  const before = await readStatSnapshot(state, entry.path, signal);
  if (before?.type !== "file") throw createResolverError("state_changed");
  if (before.size > maxFileBytes) throw createResolverError("resource_limit");
  let content: unknown;
  try {
    content = await state.read(entry.path);
  } catch {
    if (signal.aborted) throw createResolverError("aborted");
    throw createResolverError("vault_unavailable");
  }
  throwIfAborted(signal);
  assertOwnerCurrent(state);
  if (typeof content !== "string") {
    throw createResolverError("adapter_payload_invalid");
  }
  const after = await readStatSnapshot(state, entry.path, signal);
  if (!after || !sameAdapterStat(before, after)) {
    throw createResolverError("state_changed");
  }
  return Object.freeze({
    observation: Object.freeze({
      targetId: request.targetId,
      kind: "file" as const,
      path: entry.path,
      content,
    }),
    fileByteSize: before.size,
  });
}

/** Read-only Obsidian adapter for exact compiler target observations. */
export class ObsidianKnowledgeCompilerTargetResolver
  implements CompilerTargetResolver, ObsidianKnowledgeCompilerTargetVisitPort
{
  /** Captures the exact App, Vault, adapter, and method receivers for this lifecycle. */
  constructor(app: App) {
    resolverStates.set(this, captureDependencies(app));
    Object.freeze(this);
  }

  /** Resolves a strict target batch without mutating the Vault or reading unapproved content. */
  async resolve(targets: readonly CompilerTargetRequest[], signal: AbortSignal): Promise<unknown> {
    const state = resolverStates.get(this);
    if (!state) throw createResolverError("dependency_invalid");
    try {
      if (typeof signal !== "object" || signal === null) {
        throw createResolverError("request_invalid");
      }
      throwIfAborted(signal);
      const requests = snapshotTargetRequests(targets);
      const index = captureLoadedIndex(state);
      const observations: CompilerTargetObservation[] = [];
      for (const request of requests) {
        observations.push(await resolveTarget(state, index, request, signal));
      }
      throwIfAborted(signal);
      assertOwnerCurrent(state);
      return Object.freeze(observations);
    } catch (error) {
      if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
      if (signal?.aborted) throw createResolverError("aborted");
      throw createResolverError("vault_unavailable");
    }
  }

  /** Visits one bounded target at a time and releases its content before continuing. */
  async visit(
    targets: readonly CompilerTargetRequest[],
    signal: AbortSignal,
    options: Readonly<ObsidianKnowledgeCompilerTargetVisitOptions>,
    visitor: ObsidianKnowledgeCompilerTargetVisitor
  ): Promise<void> {
    const state = resolverStates.get(this);
    if (!state) throw createResolverError("dependency_invalid");
    try {
      if (typeof signal !== "object" || signal === null || typeof visitor !== "function") {
        throw createResolverError("request_invalid");
      }
      throwIfAborted(signal);
      const requests = snapshotTargetRequests(targets);
      const visitOptions = snapshotVisitOptions(options);
      const index = captureLoadedIndex(state);
      for (const request of requests) {
        const visited = await resolveVisitedTarget(
          state,
          index,
          request,
          signal,
          visitOptions.maxFileBytes
        );
        try {
          await visitor(visited.observation, visited.fileByteSize);
        } catch (error) {
          throw new TargetVisitorFailure(error);
        }
        throwIfAborted(signal);
      }
      assertBatchLoadedIndexCurrent(state, index, requests);
      throwIfAborted(signal);
      assertOwnerCurrent(state);
    } catch (error) {
      if (error instanceof TargetVisitorFailure) {
        if (error.error instanceof Error) throw error.error;
        throw createResolverError("adapter_payload_invalid");
      }
      if (ObsidianKnowledgeCompilerTargetResolverError.inspect(error)) throw error;
      if (signal?.aborted) throw createResolverError("aborted");
      throw createResolverError("vault_unavailable");
    }
  }
}

Object.freeze(ObsidianKnowledgeCompilerTargetResolverError.prototype);
Object.freeze(ObsidianKnowledgeCompilerTargetResolverError);
Object.freeze(ObsidianKnowledgeCompilerTargetResolver.prototype);
Object.freeze(ObsidianKnowledgeCompilerTargetResolver);
