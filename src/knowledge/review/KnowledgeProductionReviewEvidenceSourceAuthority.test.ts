import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeSourceWorkflowPlanLoader,
  type KnowledgeExactArtifactReaderPort,
  type KnowledgeManifestSnapshotPort,
  type KnowledgePipelineProfilePort,
  type KnowledgeSourceExecutionPlan,
  type KnowledgeWorkflowGenerationPort,
} from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import type {
  KnowledgeBundlePipelineProfile,
  KnowledgeSourceParserProfile,
} from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { ExactSourceArtifact } from "@/knowledge/ingest/ObsidianVaultSourceWatcher";
import { createFileContentHash, createSourceContentHash } from "@/knowledge/model/fingerprint";
import type { SourceManifest } from "@/knowledge/model/types";
import type { KnowledgeByteParser } from "@/knowledge/parser/KnowledgeByteParser";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { KnowledgeProductionReviewEvidenceSourceAuthority } from "@/knowledge/review/KnowledgeProductionReviewEvidenceSourceAuthority";

const BUNDLE_ID = "personal";
const SOURCE_ID = "source-1";
const SOURCE_PATH = "Sources/Source.md";
const SCHEMA_PATH = "Knowledge/schema.md";
const SOURCE_BYTES = new TextEncoder().encode("Grounded fact.\n");
const SCHEMA_BYTES = new TextEncoder().encode("# Schema\n");

/** Creates one complete current Manifest source registration. */
function createManifest(sourcePath = SOURCE_PATH): SourceManifest {
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    revision: 1,
    entries: [
      {
        sourceId: SOURCE_ID,
        sourcePath,
        sourceKey: toWindowsPathKey(sourcePath),
        custody: "user_managed",
      },
    ],
  };
}

/** Creates the parser profile retained by the authentic execution plan. */
function createParserProfile(): KnowledgeSourceParserProfile {
  return {
    id: "markdown-utf8",
    version: "1",
    pathSuffixes: [".md"],
    configuration: { encoding: "utf-8-fatal", artifactContractVersion: 1 },
  };
}

/** Creates the secret-free pipeline profile re-proved at evidence click time. */
function createPipelineProfile(): KnowledgeBundlePipelineProfile {
  return {
    version: 1,
    bundleId: BUNDLE_ID,
    compiler: { version: "knowledge-compiler-v1", configuration: { protocolVersion: 1 } },
    parsers: [createParserProfile()],
    model: {
      provider: "private-test-provider",
      model: "private-test-model",
      configuration: {
        behaviorContractVersion: 1,
        routeContractVersion: 1,
        adapterPolicy: "knowledge-projection-only-v1",
        routingPolicy: "private-bound-capability-v1",
        structuredOutput: "decoded-json-v1",
        streaming: false,
        modelFallback: false,
        temperature: 0,
        maxTokens: 8192,
        reasoningEffort: "medium",
        verbosity: "medium",
        endpointIdentity: "1".repeat(64),
        routingIdentity: "2".repeat(64),
      },
    },
    outputLanguage: "source-language",
    okfVersion: "0.1",
    citationContractVersion: 1,
  };
}

/** Creates one exact source or schema byte receipt. */
function createArtifact(sourcePath: string, bytes: Uint8Array): ExactSourceArtifact {
  return { sourcePath, bytes, sourceContentHash: createSourceContentHash(bytes) };
}

/** Builds one authentic plan whose live Manifest can be changed after loading. */
async function createPlanHarness(): Promise<{
  plan: KnowledgeSourceExecutionPlan;
  setManifest(value: SourceManifest): void;
  setCurrent(value: boolean): void;
}> {
  let manifest = createManifest();
  let current = true;
  const parser: KnowledgeByteParser = {
    /** Returns the exact parser profile bound during plan loading. */
    getProfile: () => createParserProfile(),
    /** Returns one deterministic parser artifact; evidence resolution never invokes it. */
    parse: async () => ({
      artifact: {
        kind: "text" as const,
        sourceId: SOURCE_ID,
        artifactId: "primary",
        artifactContentHash: createFileContentHash("Grounded fact.\n"),
        text: "Grounded fact.\n",
      },
    }),
  };
  const manifestPort: KnowledgeManifestSnapshotPort = { load: async () => manifest };
  const reader: KnowledgeExactArtifactReaderPort = {
    read: async (path) => createArtifact(path, SCHEMA_BYTES),
    readExpected: async (path) => createArtifact(path, SOURCE_BYTES),
  };
  const profile: KnowledgePipelineProfilePort = {
    resolve: async () => createPipelineProfile(),
  };
  const generation: KnowledgeWorkflowGenerationPort = { isCurrent: () => current };
  const plan = await new KnowledgeSourceWorkflowPlanLoader({
    executionOwner: createKnowledgeExecutionOwner(),
    manifest: manifestPort,
    artifactReader: reader,
    pipelineProfile: profile,
    parsers: [parser],
    generation,
  }).load(
    [
      {
        projectId: "project-personal",
        config: {
          version: 1,
          id: BUNDLE_ID,
          sourceRoots: ["Sources"],
          wikiRoot: "Wiki",
          schemaRef: SCHEMA_PATH,
          reviewMode: "always",
        },
      },
    ],
    new AbortController().signal
  );
  return {
    plan,
    setManifest: (value) => {
      manifest = value;
    },
    setCurrent: (value) => {
      current = value;
    },
  };
}

describe("KnowledgeProductionReviewEvidenceSourceAuthority", () => {
  it("re-proves and returns one exact path-only frozen receipt", async () => {
    const harness = await createPlanHarness();
    const authority = new KnowledgeProductionReviewEvidenceSourceAuthority({
      plan: harness.plan,
      bundleId: BUNDLE_ID,
      assertCurrent: () => undefined,
    });

    const result = await authority.resolve(BUNDLE_ID, SOURCE_ID, new AbortController().signal);

    expect(result).toEqual({ sourcePath: SOURCE_PATH });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result ?? {})).toEqual(["sourcePath"]);
  });

  it("fails closed for unknown identities without invoking a different Bundle", async () => {
    const harness = await createPlanHarness();
    const authority = new KnowledgeProductionReviewEvidenceSourceAuthority({
      plan: harness.plan,
      bundleId: BUNDLE_ID,
      assertCurrent: () => undefined,
    });

    await expect(
      authority.resolve("other", SOURCE_ID, new AbortController().signal)
    ).resolves.toBeUndefined();
    await expect(
      authority.resolve(BUNDLE_ID, "missing-source", new AbortController().signal)
    ).resolves.toBeUndefined();
  });

  it("rejects Manifest path drift against the retained watch-plan generation", async () => {
    const harness = await createPlanHarness();
    const authority = new KnowledgeProductionReviewEvidenceSourceAuthority({
      plan: harness.plan,
      bundleId: BUNDLE_ID,
      assertCurrent: () => undefined,
    });
    harness.setManifest({
      ...createManifest("Sources/Moved.md"),
      revision: 2,
    });

    await expect(
      authority.resolve(BUNDLE_ID, SOURCE_ID, new AbortController().signal)
    ).rejects.toMatchObject({ code: "manifest_stale" });
  });

  it("rejects cancellation and stale workflow generation before returning a path", async () => {
    const harness = await createPlanHarness();
    const authority = new KnowledgeProductionReviewEvidenceSourceAuthority({
      plan: harness.plan,
      bundleId: BUNDLE_ID,
      assertCurrent: () => undefined,
    });
    const aborted = new AbortController();
    aborted.abort();
    await expect(authority.resolve(BUNDLE_ID, SOURCE_ID, aborted.signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    harness.setCurrent(false);
    await expect(
      authority.resolve(BUNDLE_ID, SOURCE_ID, new AbortController().signal)
    ).rejects.toMatchObject({ code: "generation_stale" });
  });
});
