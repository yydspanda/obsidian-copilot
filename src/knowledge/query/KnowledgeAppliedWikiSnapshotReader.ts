import type {
  CompilerTargetObservation,
  CompilerTargetRequest,
  CompilerTargetResolver,
} from "@/knowledge/compiler/CompilerModelPort";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import { validateKnowledgeBundleConfig } from "@/knowledge/model/validation";
import { isPathWithinRoot, parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type {
  KnowledgeRuntimeAppliedPageProvenance,
  KnowledgeRuntimeAppliedProvenanceSnapshot,
  KnowledgeRuntimeAppliedSourceProvenance,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  snapshotKnowledgeAppliedWikiEffectivePageHead,
  type KnowledgeAppliedWikiEffectivePageHead,
} from "@/knowledge/query/KnowledgeAppliedWikiEffectivePageHead";
import { sha256 } from "@/utils/hash";

const DEFAULT_MAX_CONSISTENCY_ATTEMPTS = 3;
const MAX_APPLIED_WIKI_PAGES = 10_000;
const MAX_APPLIED_WIKI_CHARACTERS = 32_000_000;

export interface KnowledgeAppliedProvenanceReadPort {
  readAppliedProvenance(bundleId: string): Promise<KnowledgeRuntimeAppliedProvenanceSnapshot>;
}

export interface KnowledgeVerifiedWikiPage {
  evidenceId: string;
  path: string;
  windowsPathKey: string;
  ownership: KnowledgeRuntimeAppliedPageProvenance["ownership"];
  sourceAppliedContentHash: string;
  effectiveContentHash: string;
  contentHash: string;
  origin: KnowledgeAppliedWikiEffectivePageHead["origin"];
  content: string;
  sources: readonly Readonly<KnowledgeRuntimeAppliedSourceProvenance>[];
}

export interface KnowledgeVerifiedWikiSnapshot {
  bundleId: string;
  runtimeRevision: number;
  manifestRevision: number;
  pages: readonly Readonly<KnowledgeVerifiedWikiPage>[];
}

export interface KnowledgeAppliedWikiSnapshotReaderInput {
  runtime: KnowledgeAppliedProvenanceReadPort;
  bundle: KnowledgeBundleConfig;
  targetResolver: CompilerTargetResolver;
  assertCurrent(): void;
  maxConsistencyAttempts?: number;
}

export class KnowledgeAppliedWikiSnapshotReadError extends Error {
  constructor() {
    super("The applied knowledge Wiki could not be read consistently");
    this.name = "KnowledgeAppliedWikiSnapshotReadError";
  }
}

class KnowledgeAppliedWikiConsistencyRetry extends Error {
  constructor() {
    super("Applied knowledge changed during the Wiki read");
    this.name = "KnowledgeAppliedWikiConsistencyRetry";
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createWikiEvidenceId(
  bundleId: string,
  windowsPathKey: string,
  contentHash: string
): string {
  return `wiki-${sha256(`knowledge-applied-wiki-evidence-v1\u0000${bundleId}\u0000${windowsPathKey}\u0000${contentHash}`)}`;
}

function freezeSourceProvenance(
  source: KnowledgeRuntimeAppliedSourceProvenance
): Readonly<KnowledgeRuntimeAppliedSourceProvenance> {
  const citations = source.citations.map((citation) =>
    Object.freeze({
      ...citation,
      locator: Object.freeze({ ...citation.locator }),
    })
  );
  return Object.freeze({
    ...source,
    citations: Object.freeze(citations),
  });
}

function readExactRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string") ||
      !expectedKeys.every((key) => keys.includes(key))
    ) {
      return undefined;
    }
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function snapshotPageAuthority(
  bundle: KnowledgeBundleConfig,
  page: KnowledgeRuntimeAppliedPageProvenance
): Readonly<KnowledgeRuntimeAppliedPageProvenance> {
  const record = readExactRecord(page, [
    "path",
    "windowsPathKey",
    "ownership",
    "sourceAppliedContentHash",
    "effectiveContentHash",
    "contentHash",
    "origin",
    "sources",
  ]);
  const parsed = typeof record?.path === "string" ? parseVaultPath(record.path) : undefined;
  if (
    !record ||
    !parsed?.ok ||
    parsed.path !== record.path ||
    !isPathWithinRoot(parsed.path, bundle.wikiRoot) ||
    record.windowsPathKey !== toWindowsPathKey(parsed.path) ||
    (record.ownership !== "generated" &&
      record.ownership !== "shared" &&
      record.ownership !== "user") ||
    !Array.isArray(record.sources) ||
    record.sources.length === 0
  ) {
    throw new KnowledgeAppliedWikiSnapshotReadError();
  }
  const sources = (record.sources as KnowledgeRuntimeAppliedSourceProvenance[]).map(
    freezeSourceProvenance
  );
  let head: Readonly<KnowledgeAppliedWikiEffectivePageHead>;
  try {
    head = snapshotKnowledgeAppliedWikiEffectivePageHead(
      {
        sourceAppliedContentHash: record.sourceAppliedContentHash,
        effectiveContentHash: record.effectiveContentHash,
        contentHash: record.contentHash,
        origin: record.origin,
      },
      {
        bundleId: bundle.id,
        pagePath: parsed.path,
        windowsPathKey: record.windowsPathKey,
        ownership: record.ownership,
        sourceIds: sources.map((source) => source.sourceId),
      }
    );
  } catch {
    throw new KnowledgeAppliedWikiSnapshotReadError();
  }
  return Object.freeze({
    path: parsed.path,
    windowsPathKey: record.windowsPathKey,
    ownership: record.ownership,
    ...head,
    sources: Object.freeze(sources),
  });
}

function snapshotAppliedProjection(
  bundle: KnowledgeBundleConfig,
  value: KnowledgeRuntimeAppliedProvenanceSnapshot
): KnowledgeRuntimeAppliedProvenanceSnapshot {
  if (
    value.bundleId !== bundle.id ||
    !Number.isSafeInteger(value.runtimeRevision) ||
    value.runtimeRevision < 0 ||
    !Number.isSafeInteger(value.manifestRevision) ||
    value.manifestRevision < 0 ||
    value.pages.length > MAX_APPLIED_WIKI_PAGES
  ) {
    throw new KnowledgeAppliedWikiSnapshotReadError();
  }
  const pages = value.pages.map((page) => snapshotPageAuthority(bundle, page));
  const pathKeys = new Set<string>();
  for (const page of pages) {
    if (pathKeys.has(page.windowsPathKey)) throw new KnowledgeAppliedWikiSnapshotReadError();
    pathKeys.add(page.windowsPathKey);
  }
  pages.sort((left, right) => compareText(left.windowsPathKey, right.windowsPathKey));
  return Object.freeze({
    bundleId: value.bundleId,
    runtimeRevision: value.runtimeRevision,
    manifestRevision: value.manifestRevision,
    pages: Object.freeze(pages),
  });
}

function createPageRequests(
  bundleId: string,
  pages: readonly Readonly<KnowledgeRuntimeAppliedPageProvenance>[]
): readonly Readonly<CompilerTargetRequest>[] {
  return Object.freeze(
    pages.map((page) =>
      Object.freeze({
        targetId: createWikiEvidenceId(bundleId, page.windowsPathKey, page.effectiveContentHash),
        path: page.path,
        intent: "write" as const,
        access: "authorized" as const,
      })
    )
  );
}

function parsePageObservations(
  value: unknown,
  requests: readonly Readonly<CompilerTargetRequest>[]
): readonly Readonly<Extract<CompilerTargetObservation, { kind: "file" }>>[] {
  if (!Array.isArray(value) || value.length !== requests.length) {
    throw new KnowledgeAppliedWikiConsistencyRetry();
  }
  const byId = new Map<string, Extract<CompilerTargetObservation, { kind: "file" }>>();
  for (const candidate of value as readonly unknown[]) {
    if (typeof candidate !== "object" || candidate === null) {
      throw new KnowledgeAppliedWikiConsistencyRetry();
    }
    const observation = candidate as Partial<CompilerTargetObservation>;
    if (
      observation.kind !== "file" ||
      typeof observation.targetId !== "string" ||
      typeof observation.path !== "string" ||
      typeof observation.content !== "string" ||
      byId.has(observation.targetId)
    ) {
      throw new KnowledgeAppliedWikiConsistencyRetry();
    }
    byId.set(
      observation.targetId,
      observation as Extract<CompilerTargetObservation, { kind: "file" }>
    );
  }
  return Object.freeze(
    requests.map((request) => {
      const observation = byId.get(request.targetId);
      if (
        !observation ||
        observation.path !== request.path ||
        toWindowsPathKey(observation.path) !== toWindowsPathKey(request.path)
      ) {
        throw new KnowledgeAppliedWikiConsistencyRetry();
      }
      return Object.freeze({ ...observation });
    })
  );
}

function createVerifiedPages(
  projection: KnowledgeRuntimeAppliedProvenanceSnapshot,
  requests: readonly Readonly<CompilerTargetRequest>[],
  observations: readonly Readonly<Extract<CompilerTargetObservation, { kind: "file" }>>[]
): readonly Readonly<KnowledgeVerifiedWikiPage>[] {
  let characters = 0;
  return Object.freeze(
    projection.pages.map((page, index) => {
      const request = requests[index];
      const observation = observations[index];
      characters += observation.content.length;
      if (
        characters > MAX_APPLIED_WIKI_CHARACTERS ||
        request.path !== page.path ||
        sha256(observation.content) !== page.effectiveContentHash
      ) {
        throw new KnowledgeAppliedWikiConsistencyRetry();
      }
      return Object.freeze({
        evidenceId: request.targetId,
        path: page.path,
        windowsPathKey: page.windowsPathKey,
        ownership: page.ownership,
        sourceAppliedContentHash: page.sourceAppliedContentHash,
        effectiveContentHash: page.effectiveContentHash,
        contentHash: page.effectiveContentHash,
        origin: page.origin,
        content: observation.content,
        sources: page.sources,
      });
    })
  );
}

export class KnowledgeAppliedWikiSnapshotReader {
  private readonly bundle: KnowledgeBundleConfig;
  private readonly maxConsistencyAttempts: number;

  constructor(private readonly input: KnowledgeAppliedWikiSnapshotReaderInput) {
    if (
      !input ||
      typeof input.runtime?.readAppliedProvenance !== "function" ||
      typeof input.targetResolver?.resolve !== "function" ||
      typeof input.assertCurrent !== "function" ||
      !validateKnowledgeBundleConfig(input.bundle).valid
    ) {
      throw new KnowledgeAppliedWikiSnapshotReadError();
    }
    this.bundle = Object.freeze({
      ...input.bundle,
      sourceRoots: Object.freeze([...input.bundle.sourceRoots]) as unknown as string[],
    });
    this.maxConsistencyAttempts = input.maxConsistencyAttempts ?? DEFAULT_MAX_CONSISTENCY_ATTEMPTS;
    if (!Number.isSafeInteger(this.maxConsistencyAttempts) || this.maxConsistencyAttempts < 1) {
      throw new KnowledgeAppliedWikiSnapshotReadError();
    }
  }

  async read(signal: AbortSignal): Promise<KnowledgeVerifiedWikiSnapshot> {
    for (let attempt = 0; attempt < this.maxConsistencyAttempts; attempt += 1) {
      try {
        throwIfAborted(signal);
        this.input.assertCurrent();
        const before = snapshotAppliedProjection(
          this.bundle,
          await this.input.runtime.readAppliedProvenance(this.bundle.id)
        );
        throwIfAborted(signal);
        this.input.assertCurrent();
        const requests = createPageRequests(this.bundle.id, before.pages);
        const observations = parsePageObservations(
          await this.input.targetResolver.resolve(requests, signal),
          requests
        );
        throwIfAborted(signal);
        this.input.assertCurrent();
        const pages = createVerifiedPages(before, requests, observations);
        const after = snapshotAppliedProjection(
          this.bundle,
          await this.input.runtime.readAppliedProvenance(this.bundle.id)
        );
        throwIfAborted(signal);
        this.input.assertCurrent();
        if (before.runtimeRevision !== after.runtimeRevision) {
          throw new KnowledgeAppliedWikiConsistencyRetry();
        }
        return Object.freeze({
          bundleId: before.bundleId,
          runtimeRevision: before.runtimeRevision,
          manifestRevision: before.manifestRevision,
          pages,
        });
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        if (error instanceof KnowledgeAppliedWikiConsistencyRetry) continue;
        throw error instanceof KnowledgeAppliedWikiSnapshotReadError
          ? error
          : new KnowledgeAppliedWikiSnapshotReadError();
      }
    }
    throw new KnowledgeAppliedWikiSnapshotReadError();
  }
}
