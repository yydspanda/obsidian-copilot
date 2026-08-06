import { createQuoteHash } from "@/knowledge/model/fingerprint";
import type { ClaimCitation, SourceManifest, SourceManifestEntry } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import type { KnowledgeFileCompareAndSwapResult } from "@/knowledge/changeset/ChangeSetValidator";
import {
  createKnowledgeQueryWritebackCapture,
  type KnowledgeQueryWritebackCapture,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";
import {
  KnowledgeProductionQueryWritebackCoordinator,
  KnowledgeProductionQueryWritebackError,
} from "@/knowledge/query/KnowledgeProductionQueryWritebackCoordinator";

const EXCERPT = "The source supports the captured answer.";

/** Creates one authentic deterministic query capture. */
function createCapture(bundleId = "personal"): KnowledgeQueryWritebackCapture {
  const citation: ClaimCitation = {
    citationId: "citation-1",
    claimId: "source-claim-1",
    relation: "supports",
    locator: {
      kind: "markdown_lines",
      sourceId: "source-1",
      artifactId: "source-1:markdown",
      artifactContentHash: "a".repeat(64),
      excerpt: EXCERPT,
      quoteHash: createQuoteHash(EXCERPT),
      startLine: 2,
      endLine: 2,
    },
  };
  return createKnowledgeQueryWritebackCapture({
    bundleId,
    query: "What is supported?",
    title: "Supported result",
    runtimeRevision: 4,
    manifestRevision: 2,
    answerStatus: "answered",
    claims: [
      {
        claimId: "answer-claim-1",
        kind: "source_fact",
        text: "The answer is supported.",
        citationRefs: ["citation-ref-1"],
      },
    ],
    insufficientEvidence: [],
    evidence: [{ citationRef: "citation-ref-1", sourcePath: "Sources/A.md", citation }],
  });
}

/** Creates one coordinator fixture with observable file and Manifest effects. */
function createFixture(options?: {
  roots?: string[];
  owners?: string[];
  fileConflict?: boolean;
  fileResult?: unknown;
}) {
  const capture = createCapture();
  const manifest: SourceManifest = {
    version: 1,
    bundleId: "personal",
    revision: 0,
    entries: [],
  };
  const writes: Array<{ path: string; content: string }> = [];
  const registrations: SourceManifestEntry[] = [];
  const refresh = jest.fn();
  const retainDrain = jest.fn();
  const registration = new KnowledgeSourceRegistrationCore(
    {
      load: async () => manifest,
      registerSource: async (_bundleId, value) => {
        const entry: SourceManifestEntry = {
          ...value,
          sourceKey: toWindowsPathKey(value.sourcePath),
        };
        manifest.entries.push(entry);
        registrations.push(entry);
        return entry;
      },
    },
    { assertCurrent: () => undefined }
  );
  const coordinator = new KnowledgeProductionQueryWritebackCoordinator({
    owners: (options?.owners ?? ["personal"]).map((id, index) => ({
      projectId: `project-${index}`,
      config: {
        version: 1,
        id,
        sourceRoots: options?.roots ?? ["Sources"],
        wikiRoot: `Wiki-${index}`,
        schemaRef: `Schema-${index}/knowledge.md`,
        reviewMode: "always",
      },
    })),
    fileStore: {
      compareAndSwap: async (path, before, after) => {
        expect(before).toEqual({ kind: "missing" });
        if (options?.fileConflict) {
          return { kind: "conflict", observation: { kind: "file", content: "other" } };
        }
        if (after.kind !== "file") throw new Error("test expected a file");
        writes.push({ path, content: after.content });
        if (options && "fileResult" in options) {
          return options.fileResult as KnowledgeFileCompareAndSwapResult;
        }
        return { kind: "applied" };
      },
    },
    registration,
    assertCurrent: () => undefined,
    onGenerationRefreshRequired: refresh,
    retainDrain,
  });
  return { capture, coordinator, writes, registrations, refresh, retainDrain, manifest };
}

describe("KnowledgeProductionQueryWritebackCoordinator", () => {
  it("creates one content-addressed managed source and registers exact writeback authority", async () => {
    const fixture = createFixture();

    await expect(
      fixture.coordinator.submit(fixture.capture, new AbortController().signal)
    ).resolves.toEqual({ kind: "registered" });

    expect(fixture.writes).toEqual([
      {
        path: `Sources/Knowledge Query ${fixture.capture.captureDigest}.md`,
        content: fixture.capture.sourceContent,
      },
    ]);
    expect(fixture.registrations).toHaveLength(1);
    expect(fixture.registrations[0]).toMatchObject({
      sourcePath: `Sources/Knowledge Query ${fixture.capture.captureDigest}.md`,
      custody: "managed_copy",
      extensions: {
        obsidianCopilotKnowledgeSourceOrigin: {
          version: 1,
          operation: "query_writeback",
          captureDigest: fixture.capture.captureDigest,
          captureContentHash: fixture.capture.sourceContentHash,
        },
      },
    });
    expect(fixture.refresh).toHaveBeenCalledTimes(1);
    expect(fixture.retainDrain).toHaveBeenCalledTimes(1);
  });

  it("converges an exact retry and still requests rebuild after durable registration", async () => {
    const fixture = createFixture();
    await fixture.coordinator.submit(fixture.capture, new AbortController().signal);
    fixture.writes.length = 0;
    fixture.refresh.mockClear();

    await expect(
      fixture.coordinator.submit(fixture.capture, new AbortController().signal)
    ).resolves.toEqual({ kind: "registered" });

    expect(fixture.registrations).toHaveLength(1);
    expect(fixture.refresh).toHaveBeenCalledTimes(1);
  });

  it("fails closed before registration on file conflict, unknown Bundle, or ambiguous root", async () => {
    for (const fixture of [
      createFixture({ fileConflict: true }),
      createFixture({ owners: ["another"] }),
      createFixture({ roots: ["Sources/A", "Sources/B"] }),
    ]) {
      await expect(
        fixture.coordinator.submit(fixture.capture, new AbortController().signal)
      ).rejects.toBeInstanceOf(KnowledgeProductionQueryWritebackError);
      expect(fixture.registrations).toHaveLength(0);
      expect(fixture.refresh).not.toHaveBeenCalled();
    }
  });

  it("rejects forged captures and caller cancellation without touching durable state", async () => {
    const fixture = createFixture();
    const abort = new AbortController();
    abort.abort();

    await expect(
      fixture.coordinator.submit({ ...fixture.capture }, new AbortController().signal)
    ).rejects.toBeInstanceOf(KnowledgeProductionQueryWritebackError);
    await expect(fixture.coordinator.submit(fixture.capture, abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fixture.writes).toHaveLength(0);
    expect(fixture.registrations).toHaveLength(0);
    expect(fixture.refresh).not.toHaveBeenCalled();
  });

  it("rejects unknown or accessor-backed CAS results before Manifest registration", async () => {
    const kindGetter = jest.fn(() => "applied");
    const accessorResult = {};
    Object.defineProperty(accessorResult, "kind", { enumerable: true, get: kindGetter });

    for (const fixture of [
      createFixture({ fileResult: { kind: "unknown" } }),
      createFixture({ fileResult: {} }),
      createFixture({ fileResult: accessorResult }),
    ]) {
      await expect(
        fixture.coordinator.submit(fixture.capture, new AbortController().signal)
      ).rejects.toBeInstanceOf(KnowledgeProductionQueryWritebackError);
      expect(fixture.registrations).toHaveLength(0);
      expect(fixture.refresh).not.toHaveBeenCalled();
    }
    expect(kindGetter).not.toHaveBeenCalled();
  });

  it("rejects an accessor-backed registration receipt without publishing success", async () => {
    const statusGetter = jest.fn(() => "registered");
    const receipt = {
      entry: {
        sourceId: `source-${"a".repeat(64)}`,
        sourceKey: "unused",
        sourcePath: "unused",
        custody: "managed_copy",
        extensions: {},
      },
    };
    Object.defineProperty(receipt, "status", { enumerable: true, get: statusGetter });
    const capture = createCapture();
    const coordinator = new KnowledgeProductionQueryWritebackCoordinator({
      owners: [
        {
          projectId: "project-1",
          config: {
            version: 1,
            id: "personal",
            sourceRoots: ["Sources"],
            wikiRoot: "Wiki",
            schemaRef: "Schema/knowledge.md",
            reviewMode: "always",
          },
        },
      ],
      fileStore: {
        compareAndSwap: async () => ({ kind: "applied" }),
      },
      registration: {
        register: async () => receipt,
      } as unknown as KnowledgeSourceRegistrationCore,
      assertCurrent: () => undefined,
      onGenerationRefreshRequired: () => undefined,
    });

    await expect(coordinator.submit(capture, new AbortController().signal)).rejects.toBeInstanceOf(
      KnowledgeProductionQueryWritebackError
    );
    expect(statusGetter).not.toHaveBeenCalled();
  });
});
