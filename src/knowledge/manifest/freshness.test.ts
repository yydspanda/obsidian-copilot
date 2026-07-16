import { decideSourceFreshness } from "@/knowledge/manifest/freshness";
import type { SourceCompileSnapshot } from "@/knowledge/model/types";

const SOURCE_HASH = "a".repeat(64);
const PIPELINE_HASH = "b".repeat(64);

/** Creates a valid successful snapshot for freshness tests. */
function createSnapshot(): SourceCompileSnapshot {
  return {
    sourceContentHash: SOURCE_HASH,
    pipelineFingerprint: PIPELINE_HASH,
    generatedPages: [
      { path: "Wiki/主题.md", ownership: "generated" },
      { path: "Wiki/共享.md", ownership: "shared" },
    ],
    changeSetId: "changeset-1",
    completedAt: 100,
  };
}

describe("decideSourceFreshness", () => {
  it("requires ingestion when a source has never committed successfully", () => {
    expect(
      decideSourceFreshness({
        sourceContentHash: SOURCE_HASH,
        pipelineFingerprint: PIPELINE_HASH,
        outputs: [],
      })
    ).toEqual({ kind: "needs_ingest", reasons: ["never_ingested"] });
  });

  it("returns up to date only when source, pipeline, and every output match", () => {
    expect(
      decideSourceFreshness({
        lastSuccessful: createSnapshot(),
        sourceContentHash: SOURCE_HASH,
        pipelineFingerprint: PIPELINE_HASH,
        outputs: [
          { path: "wiki/主题.md", exists: true },
          { path: "WIKI/共享.md", exists: true },
        ],
      })
    ).toEqual({ kind: "up_to_date" });
  });

  it("emits all stale reasons in stable contract order", () => {
    expect(
      decideSourceFreshness({
        lastSuccessful: createSnapshot(),
        sourceContentHash: "c".repeat(64),
        pipelineFingerprint: "d".repeat(64),
        outputs: [{ path: "Wiki/主题.md", exists: true }],
      })
    ).toEqual({
      kind: "needs_ingest",
      reasons: ["source_changed", "pipeline_changed", "output_missing"],
    });
  });

  it("does not treat an explicitly missing or unrelated output as complete", () => {
    expect(
      decideSourceFreshness({
        lastSuccessful: createSnapshot(),
        sourceContentHash: SOURCE_HASH,
        pipelineFingerprint: PIPELINE_HASH,
        outputs: [
          { path: "Wiki/主题.md", exists: true },
          { path: "Wiki/共享.md", exists: false },
          { path: "Wiki/其他.md", exists: true },
        ],
      })
    ).toEqual({ kind: "needs_ingest", reasons: ["output_missing"] });
  });

  it("treats a malformed legacy snapshot with no outputs as stale", () => {
    const snapshot = createSnapshot();
    snapshot.generatedPages = [];

    expect(
      decideSourceFreshness({
        lastSuccessful: snapshot,
        sourceContentHash: SOURCE_HASH,
        pipelineFingerprint: PIPELINE_HASH,
        outputs: [],
      })
    ).toEqual({ kind: "needs_ingest", reasons: ["output_missing"] });
  });
});
