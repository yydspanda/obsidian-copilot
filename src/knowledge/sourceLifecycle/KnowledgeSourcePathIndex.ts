import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const MAX_INDEXED_KNOWLEDGE_SOURCES = 10_000;

/** One registered source identity safe to expose to file-menu routing. */
export interface RegisteredKnowledgeSourcePath {
  readonly bundleId: string;
  readonly sourceId: string;
  readonly sourcePath: string;
}

/** Conditional installation identity owned by one production generation. */
export interface KnowledgeSourcePathIndexLease {
  readonly generation: number;
}

/** Immutable exact/case-alias/descendant lookup for one Vault path. */
export interface KnowledgeSourcePathMatch {
  readonly exact: readonly Readonly<RegisteredKnowledgeSourcePath>[];
  readonly caseAliases: readonly Readonly<RegisteredKnowledgeSourcePath>[];
  readonly descendants: readonly Readonly<RegisteredKnowledgeSourcePath>[];
}

interface IndexedKnowledgeSourcePath extends RegisteredKnowledgeSourcePath {
  readonly sourceKey: string;
}

/** Compares stable source identities without locale-dependent ordering. */
function compareSources(
  left: Readonly<RegisteredKnowledgeSourcePath>,
  right: Readonly<RegisteredKnowledgeSourcePath>
): number {
  if (left.sourcePath !== right.sourcePath) return left.sourcePath < right.sourcePath ? -1 : 1;
  if (left.bundleId !== right.bundleId) return left.bundleId < right.bundleId ? -1 : 1;
  return left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0;
}

/** Requires a stable non-empty identifier without retaining malformed input. */
function requireIdentifier(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Invalid Knowledge source path index input");
  }
  return value;
}

/** Captures a detached, canonical source path row. */
function snapshotSource(
  value: Readonly<RegisteredKnowledgeSourcePath>
): IndexedKnowledgeSourcePath {
  const bundleId = requireIdentifier(value.bundleId);
  const sourceId = requireIdentifier(value.sourceId);
  const parsed = parseVaultPath(value.sourcePath);
  if (!parsed.ok || parsed.path !== value.sourcePath) {
    throw new TypeError("Invalid Knowledge source path index input");
  }
  return Object.freeze({
    bundleId,
    sourceId,
    sourcePath: parsed.path,
    sourceKey: toWindowsPathKey(parsed.path),
  });
}

/** Removes the internal Windows key from a frozen user-visible projection. */
function projectSource(
  source: Readonly<IndexedKnowledgeSourcePath>
): Readonly<RegisteredKnowledgeSourcePath> {
  return Object.freeze({
    bundleId: source.bundleId,
    sourceId: source.sourceId,
    sourcePath: source.sourcePath,
  });
}

/** Creates the empty lookup shared before and between production generations. */
function createEmptyMatch(): Readonly<KnowledgeSourcePathMatch> {
  return Object.freeze({
    exact: Object.freeze([]),
    caseAliases: Object.freeze([]),
    descendants: Object.freeze([]),
  });
}

const EMPTY_MATCH = createEmptyMatch();

/**
 * Synchronous, value-only index used to warn before file-menu deletion.
 *
 * The index grants no Runtime, Manifest, Vault-write, or retirement authority.
 * Installation is conditional so closure of an obsolete production generation
 * cannot clear a newer source snapshot.
 */
export class KnowledgeSourcePathIndex {
  private generation = 0;
  private sources: readonly Readonly<IndexedKnowledgeSourcePath>[] = Object.freeze([]);

  /** Installs one complete detached source snapshot and returns its revocation lease. */
  install(
    values: readonly Readonly<RegisteredKnowledgeSourcePath>[]
  ): Readonly<KnowledgeSourcePathIndexLease> {
    if (!Array.isArray(values) || values.length > MAX_INDEXED_KNOWLEDGE_SOURCES) {
      throw new TypeError("Invalid Knowledge source path index input");
    }
    const sources = values.map(snapshotSource).sort(compareSources);
    const identities = new Set<string>();
    for (const source of sources) {
      const identity = `${source.bundleId}\u0000${source.sourceId}`;
      if (identities.has(identity)) {
        throw new TypeError("Invalid Knowledge source path index input");
      }
      identities.add(identity);
    }
    this.generation += 1;
    this.sources = Object.freeze(sources);
    return Object.freeze({ generation: this.generation });
  }

  /** Clears only the snapshot installed by the supplied exact generation lease. */
  revoke(lease: Readonly<KnowledgeSourcePathIndexLease>): void {
    if (lease.generation !== this.generation) return;
    this.generation += 1;
    this.sources = Object.freeze([]);
  }

  /** Permanently clears all currently published paths and invalidates old leases. */
  clear(): void {
    this.generation += 1;
    this.sources = Object.freeze([]);
  }

  /**
   * Looks up exact, Windows-case-alias, and descendant registered sources.
   *
   * @param path - Canonical Vault-relative file or folder path
   * @returns Detached immutable match, or an empty match for invalid paths
   */
  lookup(path: string): Readonly<KnowledgeSourcePathMatch> {
    const parsed = parseVaultPath(path);
    if (!parsed.ok || parsed.path !== path || this.sources.length === 0) return EMPTY_MATCH;
    const pathKey = toWindowsPathKey(parsed.path);
    const descendantPrefix = `${pathKey}/`;
    const exact: Readonly<RegisteredKnowledgeSourcePath>[] = [];
    const caseAliases: Readonly<RegisteredKnowledgeSourcePath>[] = [];
    const descendants: Readonly<RegisteredKnowledgeSourcePath>[] = [];
    for (const source of this.sources) {
      if (source.sourceKey === pathKey) {
        (source.sourcePath === parsed.path ? exact : caseAliases).push(projectSource(source));
      } else if (source.sourceKey.startsWith(descendantPrefix)) {
        descendants.push(projectSource(source));
      }
    }
    return Object.freeze({
      exact: Object.freeze(exact),
      caseAliases: Object.freeze(caseAliases),
      descendants: Object.freeze(descendants),
    });
  }
}
