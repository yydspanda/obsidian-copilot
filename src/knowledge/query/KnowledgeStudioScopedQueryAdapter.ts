import type { App } from "obsidian";

import type { CompilerTargetResolver } from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeProductionModelRouteLease } from "@/knowledge/compiler/KnowledgeProductionModelRouteLease";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import { validateKnowledgeBundleConfig } from "@/knowledge/model/validation";
import { isPathWithinRoot } from "@/knowledge/paths/vaultPath";
import {
  KnowledgeAppliedWikiSnapshotReader,
  type KnowledgeAppliedProvenanceReadPort,
} from "@/knowledge/query/KnowledgeAppliedWikiSnapshotReader";
import { KnowledgeScopedLexicalRetriever } from "@/knowledge/query/KnowledgeScopedLexicalRetriever";
import {
  KnowledgeScopedQueryCoordinator,
  KnowledgeScopedQueryError,
  type KnowledgeCitationNavigationPort,
  type KnowledgeCitationNavigationTarget,
  type KnowledgeStudioQueryResult,
  type KnowledgeQueryIdFactory,
  type KnowledgeStudioQueryPort,
  type KnowledgeStudioQueryRequest,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";
import type {
  KnowledgeQueryWritebackSubmissionPort,
  KnowledgeStudioQueryWritebackPort,
  KnowledgeStudioQueryWritebackRequest,
  KnowledgeStudioQueryWritebackResult,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";
import { ObsidianKnowledgeCitationNavigator } from "@/knowledge/query/ObsidianKnowledgeCitationNavigator";

const OPAQUE_RANDOM_BYTE_COUNT = 16;

export type KnowledgeQuerySecureRandomPort = Pick<Crypto, "getRandomValues">;

export interface KnowledgeStudioScopedQueryAdapterInput {
  readonly app: App;
  readonly runtime: KnowledgeAppliedProvenanceReadPort;
  readonly bundles: readonly KnowledgeBundleConfig[];
  readonly targetResolver: CompilerTargetResolver;
  readonly modelRouteLease?: KnowledgeProductionModelRouteLease;
  readonly writeback?: KnowledgeQueryWritebackSubmissionPort;
  readonly assertCurrent: () => void;
  readonly secureRandom?: KnowledgeQuerySecureRandomPort;
}

interface KnowledgeStudioScopedQueryAdapterState {
  readonly coordinators: ReadonlyMap<string, KnowledgeScopedQueryCoordinator>;
  readonly assertCurrent: () => void;
  closed: boolean;
}

const scopedQueryAdapterStates = new WeakMap<object, KnowledgeStudioScopedQueryAdapterState>();

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let token = "";
  for (const byte of bytes) token += byte.toString(16).padStart(2, "0");
  return token;
}

export function createKnowledgeQueryIdFactory(
  secureRandom: KnowledgeQuerySecureRandomPort
): KnowledgeQueryIdFactory {
  if (!secureRandom || typeof secureRandom.getRandomValues !== "function") {
    throw new KnowledgeScopedQueryError();
  }
  return () => {
    const bytes = new Uint8Array(OPAQUE_RANDOM_BYTE_COUNT);
    try {
      secureRandom.getRandomValues(bytes);
    } catch {
      throw new KnowledgeScopedQueryError();
    }
    return bytesToHex(bytes);
  };
}

function snapshotBundles(
  bundles: readonly KnowledgeBundleConfig[]
): ReadonlyMap<string, Readonly<KnowledgeBundleConfig>> {
  if (bundles.length === 0) throw new KnowledgeScopedQueryError();
  const byId = new Map<string, Readonly<KnowledgeBundleConfig>>();
  for (const bundle of bundles) {
    if (!validateKnowledgeBundleConfig(bundle).valid || byId.has(bundle.id)) {
      throw new KnowledgeScopedQueryError();
    }
    byId.set(
      bundle.id,
      Object.freeze({
        ...bundle,
        sourceRoots: Object.freeze([...bundle.sourceRoots]) as unknown as string[],
      })
    );
  }
  return byId;
}

function requireAdapterState(value: unknown): KnowledgeStudioScopedQueryAdapterState {
  if (typeof value !== "object" || value === null) throw new KnowledgeScopedQueryError();
  const state = scopedQueryAdapterStates.get(value);
  if (!state) throw new KnowledgeScopedQueryError();
  return state;
}

function createBundleCitationNavigationPort(
  navigator: ObsidianKnowledgeCitationNavigator,
  bundle: Readonly<KnowledgeBundleConfig>,
  assertCurrent: () => void,
  isClosed: () => boolean
): KnowledgeCitationNavigationPort {
  return Object.freeze({
    verify: async (
      target: Readonly<KnowledgeCitationNavigationTarget>,
      signal: AbortSignal
    ): Promise<boolean> => {
      throwIfAborted(signal);
      if (isClosed()) throw new KnowledgeScopedQueryError();
      assertCurrent();
      if (!bundle.sourceRoots.some((root) => isPathWithinRoot(target.sourcePath, root))) {
        throw new KnowledgeScopedQueryError();
      }
      const result = await navigator.verify(
        { sourcePath: target.sourcePath, citation: target.citation },
        signal
      );
      throwIfAborted(signal);
      if (isClosed()) throw new KnowledgeScopedQueryError();
      assertCurrent();
      return result.status === "verified";
    },
    open: async (
      target: Readonly<KnowledgeCitationNavigationTarget>,
      signal: AbortSignal
    ): Promise<void> => {
      throwIfAborted(signal);
      if (isClosed()) throw new KnowledgeScopedQueryError();
      assertCurrent();
      if (!bundle.sourceRoots.some((root) => isPathWithinRoot(target.sourcePath, root))) {
        throw new KnowledgeScopedQueryError();
      }
      const result = await navigator.navigate(
        { sourcePath: target.sourcePath, citation: target.citation },
        signal
      );
      throwIfAborted(signal);
      if (isClosed()) throw new KnowledgeScopedQueryError();
      assertCurrent();
      if (result.status !== "opened") throw new KnowledgeScopedQueryError();
    },
  });
}

export class KnowledgeStudioScopedQueryAdapter
  implements KnowledgeStudioQueryPort, KnowledgeStudioQueryWritebackPort
{
  constructor(input: KnowledgeStudioScopedQueryAdapterInput) {
    if (
      !input ||
      typeof input.app !== "object" ||
      input.app === null ||
      typeof input.runtime?.readAppliedProvenance !== "function" ||
      !Array.isArray(input.bundles) ||
      typeof input.targetResolver?.resolve !== "function" ||
      typeof input.assertCurrent !== "function"
    ) {
      throw new KnowledgeScopedQueryError();
    }
    const bundles = snapshotBundles(input.bundles);
    const secureRandom = input.secureRandom ?? crypto;
    const idFactory = createKnowledgeQueryIdFactory(secureRandom);
    const navigator = new ObsidianKnowledgeCitationNavigator(input.app);
    if (input.modelRouteLease !== undefined) {
      KnowledgeProductionModelRouteLease.assert(input.modelRouteLease);
      input.modelRouteLease.assertCurrent();
    }
    const coordinators = new Map<string, KnowledgeScopedQueryCoordinator>();
    const state: KnowledgeStudioScopedQueryAdapterState = {
      coordinators,
      assertCurrent: input.assertCurrent,
      closed: false,
    };
    scopedQueryAdapterStates.set(this, state);
    for (const bundle of bundles.values()) {
      const reader = new KnowledgeAppliedWikiSnapshotReader({
        runtime: input.runtime,
        bundle,
        targetResolver: input.targetResolver,
        assertCurrent: input.assertCurrent,
      });
      const citationNavigation = createBundleCitationNavigationPort(
        navigator,
        bundle,
        input.assertCurrent,
        () => state.closed
      );
      coordinators.set(
        bundle.id,
        new KnowledgeScopedQueryCoordinator({
          bundleId: bundle.id,
          reader,
          retriever: new KnowledgeScopedLexicalRetriever(),
          citationNavigation,
          idFactory,
          ...(input.modelRouteLease === undefined
            ? {}
            : {
                answerModel: input.modelRouteLease.createGroundedAnswerModelPort(bundle.id),
              }),
          ...(input.writeback === undefined ? {} : { writeback: input.writeback }),
        })
      );
    }
    Object.freeze(this);
  }

  private requireCoordinator(bundleId: string): KnowledgeScopedQueryCoordinator {
    const state = requireAdapterState(this);
    if (state.closed) throw new KnowledgeScopedQueryError();
    state.assertCurrent();
    const coordinator = state.coordinators.get(bundleId);
    if (!coordinator) throw new KnowledgeScopedQueryError();
    return coordinator;
  }

  async query(
    bundleId: string,
    request: Readonly<KnowledgeStudioQueryRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryResult> {
    throwIfAborted(signal);
    return this.requireCoordinator(bundleId).query(bundleId, request, signal);
  }

  async openCitation(
    bundleId: string,
    queryId: string,
    citationRef: string,
    signal: AbortSignal
  ): Promise<void> {
    throwIfAborted(signal);
    return this.requireCoordinator(bundleId).openCitation(bundleId, queryId, citationRef, signal);
  }

  async saveQueryToWiki(
    bundleId: string,
    queryId: string,
    request: Readonly<KnowledgeStudioQueryWritebackRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryWritebackResult> {
    throwIfAborted(signal);
    return this.requireCoordinator(bundleId).saveQueryToWiki(bundleId, queryId, request, signal);
  }

  revokeCurrent(bundleId: string, queryId?: string): void {
    this.requireCoordinator(bundleId).revokeCurrent(bundleId, queryId);
  }

  close(): void {
    const state = requireAdapterState(this);
    if (state.closed) return;
    state.closed = true;
    for (const coordinator of state.coordinators.values()) coordinator.close();
  }
}

Object.freeze(KnowledgeStudioScopedQueryAdapter.prototype);
Object.freeze(KnowledgeStudioScopedQueryAdapter);
