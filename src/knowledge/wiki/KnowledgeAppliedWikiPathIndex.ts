import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";

/** Maximum advisory rows accepted by one exact path-index generation. */
export const KNOWLEDGE_APPLIED_WIKI_PATH_INDEX_MAX_ROWS = 10_000;
const MAX_BUNDLE_ID_LENGTH = 256;
const EMPTY_ROWS: readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[] = Object.freeze([]);

/** Display-independent applied-page row published by one released production generation. */
export interface KnowledgeAppliedWikiPathIndexRow {
  readonly bundleId: string;
  readonly pagePath: string;
}

/** Opaque exact-installation lease used only to conditionally revoke an index generation. */
export interface KnowledgeAppliedWikiPathIndexLease {
  readonly __knowledgeAppliedWikiPathIndexLease: unique symbol;
}

interface PathIndexGeneration {
  readonly rowsByExactPath: ReadonlyMap<
    string,
    readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]
  >;
}

interface PathIndexLeaseBinding {
  readonly index: KnowledgeAppliedWikiPathIndex;
  readonly generation: PathIndexGeneration;
}

interface PathIndexState {
  generation: PathIndexGeneration;
  disposed: boolean;
}

const leaseBindings = new WeakMap<object, Readonly<PathIndexLeaseBinding>>();
const pathIndexStates = new WeakMap<object, PathIndexState>();

/** Sanitized malformed-installation failure retaining no Bundle or Vault path. */
export class KnowledgeAppliedWikiPathIndexError extends Error {
  /** Creates one value-free index error. */
  constructor() {
    super("The applied knowledge Wiki path index is invalid");
    this.name = "KnowledgeAppliedWikiPathIndexError";
  }
}

/** Reads one exact row without invoking property accessors. */
function snapshotRow(value: unknown): Readonly<KnowledgeAppliedWikiPathIndexRow> | undefined {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      Reflect.ownKeys(value).length !== 2
    ) {
      return undefined;
    }
    const bundleId = Object.getOwnPropertyDescriptor(value, "bundleId");
    const pagePath = Object.getOwnPropertyDescriptor(value, "pagePath");
    if (
      !bundleId ||
      !("value" in bundleId) ||
      !bundleId.enumerable ||
      typeof bundleId.value !== "string" ||
      bundleId.value.length === 0 ||
      bundleId.value.length > MAX_BUNDLE_ID_LENGTH ||
      bundleId.value.trim() !== bundleId.value ||
      !pagePath ||
      !("value" in pagePath) ||
      !pagePath.enumerable ||
      typeof pagePath.value !== "string" ||
      pagePath.value.length > KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxDisplayPathLength
    ) {
      return undefined;
    }
    const parsed = parseVaultPath(pagePath.value);
    if (!parsed.ok || parsed.path !== pagePath.value) return undefined;
    return Object.freeze({ bundleId: bundleId.value, pagePath: parsed.path });
  } catch {
    return undefined;
  }
}

/** Snapshots one dense bounded row array without invoking indexed getters. */
function snapshotRows(value: unknown): readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[] {
  try {
    if (!Array.isArray(value)) {
      throw new KnowledgeAppliedWikiPathIndexError();
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > KNOWLEDGE_APPLIED_WIKI_PATH_INDEX_MAX_ROWS
    ) {
      throw new KnowledgeAppliedWikiPathIndexError();
    }
    const length = lengthDescriptor.value;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== length + 1 ||
      !ownKeys.includes("length") ||
      ownKeys.some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)
      )
    ) {
      throw new KnowledgeAppliedWikiPathIndexError();
    }
    const rows: Readonly<KnowledgeAppliedWikiPathIndexRow>[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      const row =
        descriptor && "value" in descriptor && descriptor.enumerable
          ? snapshotRow(descriptor.value)
          : undefined;
      if (!row) throw new KnowledgeAppliedWikiPathIndexError();
      rows.push(row);
    }
    return Object.freeze(rows);
  } catch {
    throw new KnowledgeAppliedWikiPathIndexError();
  }
}

/** Compares identifiers without locale-sensitive ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Creates one immutable exact-path lookup generation after collision checks. */
function createGeneration(
  value: readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]
): PathIndexGeneration {
  const rows = snapshotRows(value);
  const exactIdentity = new Set<string>();
  const spellingByWindowsKey = new Map<string, string>();
  const mutable = new Map<string, Readonly<KnowledgeAppliedWikiPathIndexRow>[]>();
  for (const row of rows) {
    const pathKey = toWindowsPathKey(row.pagePath);
    const existingSpelling = spellingByWindowsKey.get(pathKey);
    if (existingSpelling !== undefined && existingSpelling !== row.pagePath) {
      throw new KnowledgeAppliedWikiPathIndexError();
    }
    spellingByWindowsKey.set(pathKey, row.pagePath);
    const identity = `${row.bundleId}\u0000${pathKey}`;
    if (exactIdentity.has(identity)) throw new KnowledgeAppliedWikiPathIndexError();
    exactIdentity.add(identity);
    const matching = mutable.get(row.pagePath);
    if (matching) matching.push(row);
    else mutable.set(row.pagePath, [row]);
  }
  const rowsByExactPath = new Map<string, readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]>();
  for (const [pagePath, matching] of mutable) {
    matching.sort((left, right) => compareText(left.bundleId, right.bundleId));
    rowsByExactPath.set(pagePath, Object.freeze(matching));
  }
  return Object.freeze({ rowsByExactPath });
}

/** Returns hidden state only for an authentic index instance. */
function requirePathIndexState(value: unknown): PathIndexState {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== KnowledgeAppliedWikiPathIndex.prototype
    ) {
      throw new KnowledgeAppliedWikiPathIndexError();
    }
    const state = pathIndexStates.get(value);
    if (!state) throw new KnowledgeAppliedWikiPathIndexError();
    return state;
  } catch {
    throw new KnowledgeAppliedWikiPathIndexError();
  }
}

/**
 * Synchronous advisory index for deciding whether to expose a current-page command.
 *
 * A positive lookup is never mutation/read authority. The inspector must perform
 * the complete Runtime/Vault/Runtime reproof after the user invokes the command.
 */
export class KnowledgeAppliedWikiPathIndex {
  /** Creates a frozen empty advisory index. */
  constructor() {
    pathIndexStates.set(this, { generation: createGeneration(EMPTY_ROWS), disposed: false });
    Object.freeze(this);
  }

  /** Atomically replaces all rows and returns an opaque exact-generation lease. */
  install(
    rows: readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[]
  ): KnowledgeAppliedWikiPathIndexLease {
    const state = requirePathIndexState(this);
    if (state.disposed) throw new KnowledgeAppliedWikiPathIndexError();
    const generation = createGeneration(rows);
    const lease = Object.freeze(Object.create(null)) as KnowledgeAppliedWikiPathIndexLease;
    leaseBindings.set(lease, Object.freeze({ index: this, generation }));
    state.generation = generation;
    return lease;
  }

  /**
   * Returns frozen rows only for an exact canonical spelling.
   *
   * Multiple rows expose an ambiguous multi-Bundle observation instead of choosing
   * an authority. Callers need only test `length`; inspection still accepts path only.
   */
  lookupExact(pagePath: string): readonly Readonly<KnowledgeAppliedWikiPathIndexRow>[] {
    const state = requirePathIndexState(this);
    if (
      state.disposed ||
      typeof pagePath !== "string" ||
      pagePath.length > KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxDisplayPathLength
    ) {
      return EMPTY_ROWS;
    }
    const parsed = parseVaultPath(pagePath);
    if (!parsed.ok || parsed.path !== pagePath) return EMPTY_ROWS;
    return state.generation.rowsByExactPath.get(pagePath) ?? EMPTY_ROWS;
  }

  /** Conditionally empties the index only for its exact current installation. */
  revoke(lease: KnowledgeAppliedWikiPathIndexLease): void {
    const state = requirePathIndexState(this);
    if (state.disposed || typeof lease !== "object" || lease === null) return;
    const binding = leaseBindings.get(lease);
    if (!binding || binding.index !== this || binding.generation !== state.generation) return;
    state.generation = createGeneration(EMPTY_ROWS);
  }

  /** Permanently empties and closes this advisory index. */
  dispose(): void {
    const state = requirePathIndexState(this);
    if (state.disposed) return;
    state.disposed = true;
    state.generation = createGeneration(EMPTY_ROWS);
  }
}

Object.freeze(KnowledgeAppliedWikiPathIndex.prototype);
Object.freeze(KnowledgeAppliedWikiPathIndex);
