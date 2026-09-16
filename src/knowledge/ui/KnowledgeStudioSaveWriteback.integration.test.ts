import { waitFor } from "@testing-library/react";
import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import { INGEST_QUEUE_VERSION } from "@/knowledge/ingest/queue/QueueStorage";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type { ClaimCitation, KnowledgeBundleConfig, SourceManifest } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type { KnowledgeVerifiedWikiSnapshot } from "@/knowledge/query/KnowledgeAppliedWikiSnapshotReader";
import { KnowledgeProductionQueryWritebackCoordinator } from "@/knowledge/query/KnowledgeProductionQueryWritebackCoordinator";
import { KnowledgeScopedLexicalRetriever } from "@/knowledge/query/KnowledgeScopedLexicalRetriever";
import {
  KnowledgeScopedQueryCoordinator,
  type KnowledgeStudioQueryPort,
} from "@/knowledge/query/KnowledgeScopedQueryCoordinator";
import { CHANGESET_REVIEW_SNAPSHOT_VERSION } from "@/knowledge/review/ReviewStorage";
import type { KnowledgeRuntimeStudioBundleSnapshot } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KnowledgeStudioController,
  UnavailableKnowledgeStudioPort,
} from "@/knowledge/ui/KnowledgeStudioController";
import { KnowledgeStudioRuntimeReadAdapter } from "@/knowledge/ui/KnowledgeStudioRuntimeReadAdapter";

const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/9";
const BUNDLE: KnowledgeBundleConfig = {
  version: 1,
  id: "personal",
  sourceRoots: ["Sources"],
  wikiRoot: "Wiki",
  schemaRef: "Knowledge/Rules.md",
  reviewMode: "always",
};
const SOURCE_PATH = "Sources/Grounded.md";
const WIKI_PATH = "Wiki/Grounded.md";
const SOURCE_TEXT = "The knowledge engine preserves the source evidence.";
const WIKI_TEXT = `# Knowledge engine\n\n${SOURCE_TEXT}\n`;

function createGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Replaces storage and model I/O only; cancellation, captures and registration use production code. */
async function createFixture(options: { emitCreateHint?: boolean; failFileCas?: boolean } = {}) {
  const created = createGate();
  const completeCas = createGate();
  const vaultHints = new Set<() => void>();
  const runtimeHints = new Set<() => void>();
  const files = new Map([
    [SOURCE_PATH, SOURCE_TEXT],
    [WIKI_PATH, WIKI_TEXT],
  ]);
  const manifest: SourceManifest = {
    version: 1,
    bundleId: BUNDLE.id,
    revision: 2,
    entries: [],
  };
  const projection: KnowledgeRuntimeStudioBundleSnapshot = {
    bundleId: BUNDLE.id,
    runtimeRevision: 4,
    queue: {
      version: INGEST_QUEUE_VERSION,
      bundleId: BUNDLE.id,
      revision: 1,
      control: { status: "paused", reason: "user", pausedAt: 100 },
      jobs: [],
      reruns: [],
      sourceHighWatermarks: [],
      pendingReviews: [],
      reviewRejections: [],
      applyAbandonments: [],
    },
    review: {
      version: CHANGESET_REVIEW_SNAPSHOT_VERSION,
      bundleId: BUNDLE.id,
      revision: 0,
      records: [],
    },
  };
  const citation: ClaimCitation = {
    citationId: "source-citation",
    claimId: "source-claim",
    relation: "supports",
    locator: {
      kind: "markdown_lines",
      sourceId: "source-1",
      artifactId: "source-1:markdown",
      artifactContentHash: createFileContentHash(SOURCE_TEXT),
      excerpt: SOURCE_TEXT,
      quoteHash: createQuoteHash(SOURCE_TEXT),
      startLine: 1,
      endLine: 1,
    },
  };
  const wikiSnapshot: KnowledgeVerifiedWikiSnapshot = {
    bundleId: BUNDLE.id,
    runtimeRevision: 4,
    manifestRevision: 2,
    pages: [
      {
        evidenceId: "wiki-evidence-1",
        path: WIKI_PATH,
        windowsPathKey: toWindowsPathKey(WIKI_PATH),
        ownership: "generated",
        sourceAppliedContentHash: createFileContentHash(WIKI_TEXT),
        effectiveContentHash: createFileContentHash(WIKI_TEXT),
        contentHash: createFileContentHash(WIKI_TEXT),
        content: WIKI_TEXT,
        origin: { kind: "source_apply" },
        sources: [
          {
            sourceId: "source-1",
            sourcePath: SOURCE_PATH,
            custody: "user_managed",
            sourceContentHash: createFileContentHash(SOURCE_TEXT),
            pipelineFingerprint: "b".repeat(64),
            inputRevision: 1,
            changeSetId: "applied-1",
            changeSetDigest: "c".repeat(64),
            acceptedAt: 100,
            citations: [citation],
          },
        ],
      },
    ],
  };
  const refreshGeneration = jest.fn();
  const registration = new KnowledgeSourceRegistrationCore(
    {
      load: async () => manifest,
      registerSource: async (_bundleId, input) => {
        const entry = { ...input, sourceKey: toWindowsPathKey(input.sourcePath) };
        manifest.entries.push(entry);
        manifest.revision += 1;
        projection.runtimeRevision += 1;
        for (const hint of runtimeHints) hint();
        return entry;
      },
    },
    { assertCurrent: () => undefined }
  );
  const productionWriteback = new KnowledgeProductionQueryWritebackCoordinator({
    owners: [{ projectId: "personal-project", config: BUNDLE }],
    fileStore: {
      compareAndSwap: async (path, before, after) => {
        expect(before).toEqual({ kind: "missing" });
        expect(files.has(path)).toBe(false);
        if (after.kind !== "file") throw new Error("Expected an immutable source capture");
        files.set(path, after.content);
        if (options.emitCreateHint) {
          for (const hint of vaultHints) hint();
        }
        created.release();
        await completeCas.promise;
        if (options.failFileCas) throw new Error("Memory file CAS failed after create");
        return { kind: "applied" };
      },
    },
    registration,
    assertCurrent: () => undefined,
    onGenerationRefreshRequired: refreshGeneration,
  });
  let id = 0;
  let writebackSignal: AbortSignal | undefined;
  const readAppliedSnapshot = jest.fn(async () => wikiSnapshot);
  const verifySource = jest.fn(async () => files.get(SOURCE_PATH) === SOURCE_TEXT);
  const query = new KnowledgeScopedQueryCoordinator({
    bundleId: BUNDLE.id,
    reader: { read: readAppliedSnapshot },
    retriever: new KnowledgeScopedLexicalRetriever(),
    citationNavigation: {
      verify: verifySource,
      open: async () => {
        throw new Error("Navigation is outside this memory-only save test");
      },
    },
    idFactory: (kind) => `${kind}-${++id}`,
    answerModel: {
      generate: async (request) =>
        JSON.stringify({
          version: 1,
          contextDigest: request.contextDigest,
          status: "answered",
          claims: [
            {
              claimId: "answer-1",
              kind: "source_fact",
              text: SOURCE_TEXT,
              evidenceIds: ["evidence-1"],
            },
          ],
          insufficientEvidence: [],
        }),
    },
    writeback: {
      submit: (capture, signal) => {
        writebackSignal = signal;
        return productionWriteback.submit(capture, signal);
      },
    },
  });
  const readStudioBundle = jest.fn(async () => projection);
  const adapter = new KnowledgeStudioRuntimeReadAdapter({
    runtime: {
      readStudioBundle,
      subscribeStudioBundle: (_bundleId, hint) => {
        runtimeHints.add(hint);
        return () => {
          runtimeHints.delete(hint);
        };
      },
    },
    bundles: [BUNDLE],
    targetResolver: {
      resolve: async () => {
        throw new Error("No pending Review targets exist in this fixture");
      },
    },
    assertCurrent: () => undefined,
    query,
    subscribeVaultHints: (_bundleId, hint) => {
      vaultHints.add(hint);
      return () => {
        vaultHints.delete(hint);
      };
    },
  });
  const queryPort: KnowledgeStudioQueryPort = {
    query: (bundleId, request, signal) => adapter.query(bundleId, request, signal),
    openCitation: (bundleId, queryId, citationRef, signal) =>
      adapter.openCitation(bundleId, queryId, citationRef, signal),
    revokeCurrent: (bundleId, queryId) => adapter.revokeCurrent(bundleId, queryId),
    close: () => undefined,
  };
  const controllers = [0, 1].map(
    () =>
      new KnowledgeStudioController(
        adapter,
        new UnavailableKnowledgeStudioPort(),
        queryPort,
        adapter
      )
  );
  for (const controller of controllers) controller.start(BUNDLE.id);
  await waitFor(() => {
    for (const controller of controllers) expect(controller.getState().status).toBe("ready");
  });
  const controller = controllers[0];
  await controller.runQuery("knowledge engine");
  expect(controller.getState().query?.result).toMatchObject({
    mode: "grounded_answer",
    answer: { status: "answered" },
  });
  return {
    controller,
    controllers,
    created,
    completeCas,
    files,
    manifest,
    projection,
    refreshGeneration,
    vaultHints,
    readStudioBundle,
    readAppliedSnapshot,
    verifySource,
    wikiSnapshot,
    getWritebackSignal: () => writebackSignal,
    dispose: () => {
      completeCas.release();
      for (const current of controllers) current.destroy();
      query.close();
    },
  };
}

describe("KnowledgeStudioSaveWriteback integration", () => {
  describe("KnowledgeStudioController", () => {
    describe("saveCurrentQueryToWiki()", () => {
      it(`registers one authentic managed capture and retains success after shared Runtime reload hints — ${ISSUE}`, async () => {
        const fixture = await createFixture();
        try {
          const saving = fixture.controller.saveCurrentQueryToWiki("Grounded engine answer");
          await fixture.created.promise;
          fixture.completeCas.release();
          await saving;

          expect(fixture.files.size).toBe(3);
          expect(fixture.manifest.entries).toHaveLength(1);
          expect(fixture.manifest.entries[0]).toMatchObject({
            custody: "managed_copy",
            extensions: { obsidianCopilotKnowledgeSourceOrigin: { operation: "query_writeback" } },
          });
          expect(fixture.files.get(fixture.manifest.entries[0].sourcePath)).toContain(
            "# Grounded engine answer"
          );
          expect(fixture.refreshGeneration).toHaveBeenCalledTimes(1);
          await waitFor(() => expect(fixture.controller.getState().refreshing).toBe(false));
          expect(fixture.controller.getState().feedback?.kind).toBe("success");
          expect(fixture.files.get(SOURCE_PATH)).toBe(SOURCE_TEXT);
          expect(fixture.files.get(WIKI_PATH)).toBe(WIKI_TEXT);
          expect(fixture.projection.queue.control).toEqual({
            status: "paused",
            reason: "user",
            pausedAt: 100,
          });
        } finally {
          fixture.dispose();
        }
      });

      it(`finishes create-to-register before either shared subscriber revokes the query on its Vault hint — ${ISSUE}`, async () => {
        const fixture = await createFixture({ emitCreateHint: true });
        try {
          expect(fixture.vaultHints.size).toBe(2);
          const readsBeforeSave = fixture.readStudioBundle.mock.calls.length;
          const saving = fixture.controller.saveCurrentQueryToWiki("Grounded engine answer");
          await fixture.created.promise;

          expect(fixture.getWritebackSignal()?.aborted).toBe(false);
          expect(fixture.controller.getState().query?.savingToWiki).toBe(true);
          expect(fixture.readStudioBundle).toHaveBeenCalledTimes(readsBeforeSave);
          expect(fixture.manifest.entries).toHaveLength(0);
          fixture.completeCas.release();
          await saving;

          expect(fixture.files.size).toBe(3);
          expect(fixture.manifest.entries).toHaveLength(1);
          expect(fixture.refreshGeneration).toHaveBeenCalledTimes(1);
          await waitFor(() => {
            for (const controller of fixture.controllers)
              expect(controller.getState().refreshing).toBe(false);
          });
          expect(fixture.controller.getState().feedback?.kind).toBe("success");
          expect(fixture.controller.getState().query?.status).toBe("idle");
          expect(fixture.files.get(WIKI_PATH)).toBe(WIKI_TEXT);
        } finally {
          fixture.dispose();
        }
      });

      it(`keeps the failed capture unregistered and reports failure after the queued create hint reloads — ${ISSUE}`, async () => {
        const fixture = await createFixture({ emitCreateHint: true, failFileCas: true });
        try {
          const saving = fixture.controller.saveCurrentQueryToWiki("Grounded engine answer");
          await fixture.created.promise;
          fixture.completeCas.release();
          await saving;

          expect(fixture.files.size).toBe(3);
          expect(fixture.manifest.entries).toHaveLength(0);
          expect(fixture.refreshGeneration).not.toHaveBeenCalled();
          await waitFor(() => expect(fixture.controller.getState().refreshing).toBe(false));
          expect(fixture.controller.getState().feedback?.kind).toBe("error");
          expect(fixture.files.get(WIKI_PATH)).toBe(WIKI_TEXT);
        } finally {
          fixture.dispose();
        }
      });

      it(`rejects changed source evidence during Save before creating a capture despite its deferred Vault hint — ${ISSUE}`, async () => {
        const fixture = await createFixture();
        try {
          fixture.verifySource.mockImplementationOnce(async () => {
            fixture.files.set(SOURCE_PATH, "The external editor replaced the original evidence.");
            for (const hint of fixture.vaultHints) hint();
            return fixture.files.get(SOURCE_PATH) === SOURCE_TEXT;
          });

          await fixture.controller.saveCurrentQueryToWiki("Grounded engine answer");

          expect(fixture.getWritebackSignal()).toBeUndefined();
          expect(fixture.files.size).toBe(2);
          expect(fixture.manifest.entries).toHaveLength(0);
          expect(fixture.refreshGeneration).not.toHaveBeenCalled();
          await waitFor(() => expect(fixture.controller.getState().refreshing).toBe(false));
          expect(fixture.controller.getState().feedback?.kind).toBe("error");
          expect(fixture.files.get(WIKI_PATH)).toBe(WIKI_TEXT);
        } finally {
          fixture.dispose();
        }
      });

      it(`rejects applied Wiki drift at the second Save read before creating a capture despite its deferred Vault hint — ${ISSUE}`, async () => {
        const fixture = await createFixture();
        try {
          fixture.readAppliedSnapshot.mockClear();
          fixture.readAppliedSnapshot.mockResolvedValueOnce(fixture.wikiSnapshot);
          fixture.readAppliedSnapshot.mockImplementationOnce(async () => {
            const changedContent =
              "# Knowledge engine\n\nThe accepted page was externally changed.\n";
            fixture.files.set(WIKI_PATH, changedContent);
            for (const hint of fixture.vaultHints) hint();
            return {
              ...fixture.wikiSnapshot,
              pages: [
                {
                  ...fixture.wikiSnapshot.pages[0],
                  content: changedContent,
                  contentHash: createFileContentHash(changedContent),
                  effectiveContentHash: createFileContentHash(changedContent),
                },
              ],
            };
          });

          await fixture.controller.saveCurrentQueryToWiki("Grounded engine answer");

          expect(fixture.readAppliedSnapshot).toHaveBeenCalledTimes(2);
          expect(fixture.getWritebackSignal()).toBeUndefined();
          expect(fixture.files.size).toBe(2);
          expect(fixture.manifest.entries).toHaveLength(0);
          expect(fixture.refreshGeneration).not.toHaveBeenCalled();
          await waitFor(() => expect(fixture.controller.getState().refreshing).toBe(false));
          expect(fixture.controller.getState().feedback?.kind).toBe("error");
          expect(fixture.files.get(SOURCE_PATH)).toBe(SOURCE_TEXT);
        } finally {
          fixture.dispose();
        }
      });

      it(`still cancels registration when the user stops the session after capture creation — ${ISSUE}`, async () => {
        const fixture = await createFixture({ emitCreateHint: true });
        try {
          const saving = fixture.controller.saveCurrentQueryToWiki("Grounded engine answer");
          await fixture.created.promise;
          fixture.controller.stop();
          expect(fixture.getWritebackSignal()?.aborted).toBe(true);
          fixture.completeCas.release();
          await saving;

          expect(fixture.files.size).toBe(3);
          expect(fixture.manifest.entries).toHaveLength(0);
          expect(fixture.refreshGeneration).not.toHaveBeenCalled();
          expect(fixture.controller.getState()).toEqual({
            status: "idle",
            activeTab: "activity",
            refreshing: false,
          });
          expect(fixture.files.get(WIKI_PATH)).toBe(WIKI_TEXT);
        } finally {
          fixture.dispose();
        }
      });
    });
  });
});
