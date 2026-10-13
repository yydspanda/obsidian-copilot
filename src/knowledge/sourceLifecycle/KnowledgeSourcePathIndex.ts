import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const MAX_INDEXED_KNOWLEDGE_SOURCES = 10_000;

export interface RegisteredKnowledgeSourcePath {
  readonly bundleId: string;
  readonly sourceId: string;
  readonly sourcePath: string;
}

export interface KnowledgeSourcePathIndexLease {
  readonly generation: number;
}

export interface KnowledgeSourcePathMatch {
  readonly exact: readonly Readonly<RegisteredKnowledgeSourcePath>[];
  readonly caseAliases: readonly Readonly<RegisteredKnowledgeSourcePath>[];
  readonly descendants: readonly Readonly<RegisteredKnowledgeSourcePath>[];
}

interface IndexedKnowledgeSourcePath extends RegisteredKnowledgeSourcePath {
  readonly sourceKey: string;
}

function compareSources(
  left: Readonly<RegisteredKnowledgeSourcePath>,
  right: Readonly<RegisteredKnowledgeSourcePath>
): number {
  if (left.sourcePath !== right.sourcePath) return left.sourcePath < right.sourcePath ? -1 : 1;
  if (left.bundleId !== right.bundleId) return left.bundleId < right.bundleId ? -1 : 1;
  return left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0;
}

function requireIdentifier(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Invalid Knowledge source path index input");
  }
  return value;
}

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

function projectSource(
  source: Readonly<IndexedKnowledgeSourcePath>
): Readonly<RegisteredKnowledgeSourcePath> {
  return Object.freeze({
    bundleId: source.bundleId,
    sourceId: source.sourceId,
    sourcePath: source.sourcePath,
  });
}

function createEmptyMatch(): Readonly<KnowledgeSourcePathMatch> {
  return Object.freeze({
    exact: Object.freeze([]),
    caseAliases: Object.freeze([]),
    descendants: Object.freeze([]),
  });
}

const EMPTY_MATCH = createEmptyMatch();

export class KnowledgeSourcePathIndex {
  private generation = 0;
  private sources: readonly Readonly<IndexedKnowledgeSourcePath>[] = Object.freeze([]);

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

  revoke(lease: Readonly<KnowledgeSourcePathIndexLease>): void {
    if (lease.generation !== this.generation) return;
    this.generation += 1;
    this.sources = Object.freeze([]);
  }

  clear(): void {
    this.generation += 1;
    this.sources = Object.freeze([]);
  }

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
