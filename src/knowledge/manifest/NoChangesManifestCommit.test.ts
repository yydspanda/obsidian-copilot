import {
  createKnowledgeSourceOriginExtensions,
  deriveKnowledgeSourceCompileAuthority,
} from "@/knowledge/capture/KnowledgeSourceOrigin";
import {
  NO_CHANGES_MANIFEST_COMMIT_VERSION,
  NoChangesManifestCommitValidationError,
  createKnowledgeNoChangesCommitMarker,
  createNoChangesManifestCommitPlan,
  createNoChangesManifestCommitPlanDigest,
  parseKnowledgeNoChangesCommitMarker,
  parseNoChangesManifestCommitPlan,
  validateNoChangesManifestCommitMarker,
  validateNoChangesManifestCommitPlan,
  type CreateNoChangesManifestCommitPlanInput,
  type NoChangesManifestCommitPlan,
  type NoChangesManifestCommitReason,
} from "@/knowledge/manifest/NoChangesManifestCommit";
import type { ManifestCommitPage } from "@/knowledge/manifest/ManifestCommitIntent";
import type { SourceManifestEntry } from "@/knowledge/model/types";

const SOURCE_HASH = "a".repeat(64);
const PIPELINE_HASH = "b".repeat(64);
const COMPILE_CONTEXT_DIGEST = "c".repeat(64);
const ANALYSIS_DIGEST = "d".repeat(64);
const EVIDENCE_DIGEST = "e".repeat(64);
const EXPECTED_MANIFEST_DIGEST = "f".repeat(64);
const CAPTURE_DIGEST = "1".repeat(64);
const PAGE_HASH = "2".repeat(64);

/** Creates an ordinary source authority through the shared SourceOrigin boundary. */
function createSourceAuthority() {
  const entry: SourceManifestEntry = {
    sourceId: "source-1",
    sourceKey: "sources/note.md",
    sourcePath: "Sources/Note.md",
    custody: "user_managed",
  };
  return deriveKnowledgeSourceCompileAuthority(entry);
}

/** Creates a managed query-writeback authority through the shared SourceOrigin boundary. */
function createQueryAuthority() {
  const entry: SourceManifestEntry = {
    sourceId: "source-query",
    sourceKey: "copilot/knowledge/query.md",
    sourcePath: "Copilot/Knowledge/Query.md",
    custody: "managed_copy",
    extensions: createKnowledgeSourceOriginExtensions("query_writeback", {
      captureDigest: CAPTURE_DIGEST,
      captureContentHash: SOURCE_HASH,
    }),
  };
  return deriveKnowledgeSourceCompileAuthority(entry);
}

/** Creates one complete base page for no-changes freshness projection. */
function createPage(
  path = "Wiki/Alpha.md",
  ownership: ManifestCommitPage["ownership"] = "generated",
  contentHash = PAGE_HASH
): ManifestCommitPage {
  return { path, ownership, contentHash };
}

/** Creates a complete ordinary plan input with replaceable fields. */
function createPlanInput(
  overrides: Partial<CreateNoChangesManifestCommitPlanInput> = {}
): CreateNoChangesManifestCommitPlanInput {
  return {
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: SOURCE_HASH,
    pipelineFingerprint: PIPELINE_HASH,
    inputRevision: 7,
    compileContextDigest: COMPILE_CONTEXT_DIGEST,
    analysisDigest: ANALYSIS_DIGEST,
    evidenceDigest: EVIDENCE_DIGEST,
    reason: "all_targets_unchanged",
    expectedManifestRevision: 4,
    expectedManifestDigest: EXPECTED_MANIFEST_DIGEST,
    baseGeneratedPages: [createPage("Wiki/Zeta.md"), createPage("wiki/Alpha.md", "shared")],
    sourceAuthority: createSourceAuthority(),
    ...overrides,
  };
}

/** Creates one strict ordinary plan. */
function createPlan(
  overrides: Partial<CreateNoChangesManifestCommitPlanInput> = {}
): NoChangesManifestCommitPlan {
  return createNoChangesManifestCommitPlan(createPlanInput(overrides));
}

describe("NoChangesManifestCommit", () => {
  it.each<NoChangesManifestCommitReason>([
    "analysis_no_targets",
    "resolved_no_targets",
    "all_targets_unchanged",
  ])("creates a strict content-addressed %s plan", (reason) => {
    const plan = createPlan({ reason });

    expect(plan).toMatchObject({
      version: NO_CHANGES_MANIFEST_COMMIT_VERSION,
      kind: "source_compile",
      reason,
    });
    expect(plan.noChangesId).toMatch(/^knowledge-no-changes-[a-f0-9]{64}$/);
    expect(plan.baseGeneratedPages.map(({ path }) => path)).toEqual([
      "wiki/Alpha.md",
      "Wiki/Zeta.md",
    ]);
    expect(validateNoChangesManifestCommitPlan(plan)).toEqual({ valid: true, diagnostics: [] });
    expect(createNoChangesManifestCommitPlanDigest(plan)).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.baseGeneratedPages)).toBe(true);
    expect(plan.baseGeneratedPages.every(Object.isFrozen)).toBe(true);
  });

  it("binds the identity to evidence, reason, Manifest read-set, and base pages", () => {
    const baseline = createPlan();
    const variants = [
      createPlan({ evidenceDigest: "3".repeat(64) }),
      createPlan({ reason: "resolved_no_targets" }),
      createPlan({ expectedManifestRevision: 5 }),
      createPlan({ expectedManifestDigest: "4".repeat(64) }),
      createPlan({ baseGeneratedPages: [] }),
    ];

    for (const variant of variants) {
      expect(variant.noChangesId).not.toBe(baseline.noChangesId);
      expect(createNoChangesManifestCommitPlanDigest(variant)).not.toBe(
        createNoChangesManifestCommitPlanDigest(baseline)
      );
    }
  });

  it("creates a query-writeback variant from exact shared SourceOrigin authority", () => {
    const authority = createQueryAuthority();
    if (authority.operation !== "query_writeback") {
      throw new Error("Expected query-writeback source authority");
    }
    const plan = createPlan({
      sourceId: "source-query",
      sourceAuthority: authority,
      baseGeneratedPages: [],
    });

    expect(plan).toMatchObject({
      kind: "query_writeback_source_compile",
      sourceOriginDigest: authority.sourceOriginDigest,
    });
    expect(validateNoChangesManifestCommitPlan(plan).valid).toBe(true);
  });

  it("rejects a query-writeback source hash outside its exact capture authority", () => {
    expect(() =>
      createPlan({
        sourceId: "source-query",
        sourceContentHash: "9".repeat(64),
        sourceAuthority: createQueryAuthority(),
      })
    ).toThrow(NoChangesManifestCommitValidationError);
  });

  it("strictly parses detached plans and rejects unknown fields or noncanonical identity", () => {
    const plan = createPlan();
    const raw = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
    const parsed = parseNoChangesManifestCommitPlan(raw);
    if (!parsed.ok) throw new Error("Expected the strict plan to parse");

    expect(parsed.value).not.toBe(raw);
    expect(parsed.value.baseGeneratedPages).not.toBe(raw.baseGeneratedPages);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.baseGeneratedPages)).toBe(true);
    expect(parseNoChangesManifestCommitPlan({ ...raw, unsupported: true }).ok).toBe(false);
    expect(
      validateNoChangesManifestCommitPlan({
        ...raw,
        noChangesId: `knowledge-no-changes-${"0".repeat(64)}`,
      })
    ).toMatchObject({ valid: false });
    expect(
      validateNoChangesManifestCommitPlan({
        ...raw,
        baseGeneratedPages: [...plan.baseGeneratedPages].reverse(),
      })
    ).toMatchObject({ valid: false });
  });

  it("creates a strict marker bound to the complete plan and exact Queue claim", () => {
    const plan = createPlan();
    const marker = createKnowledgeNoChangesCommitMarker({
      plan,
      jobClaim: {
        jobId: "job-1",
        sourceId: plan.sourceId,
        sourceContentHash: plan.sourceContentHash,
        pipelineFingerprint: plan.pipelineFingerprint,
        inputRevision: plan.inputRevision,
        attempt: 2,
        startedAt: 120,
      },
      completedAt: 140,
      manifestAfterRevision: plan.expectedManifestRevision + 1,
    });

    expect(marker).toMatchObject({
      noChangesId: plan.noChangesId,
      planDigest: createNoChangesManifestCommitPlanDigest(plan),
      jobId: "job-1",
      attempt: 2,
      startedAt: 120,
      completedAt: 140,
      manifestAfterRevision: 5,
    });
    expect(validateNoChangesManifestCommitMarker(marker)).toEqual({
      valid: true,
      diagnostics: [],
    });
    expect(Object.isFrozen(marker)).toBe(true);
    expect(Object.isFrozen(marker.baseGeneratedPages)).toBe(true);
    expect(marker.baseGeneratedPages.every(Object.isFrozen)).toBe(true);
  });

  it("strictly parses markers into deeply frozen detached values", () => {
    const plan = createPlan();
    const marker = createKnowledgeNoChangesCommitMarker({
      plan,
      jobClaim: {
        jobId: "job-1",
        sourceId: plan.sourceId,
        sourceContentHash: plan.sourceContentHash,
        pipelineFingerprint: plan.pipelineFingerprint,
        inputRevision: plan.inputRevision,
        attempt: 1,
        startedAt: 100,
      },
      completedAt: 100,
      manifestAfterRevision: 5,
    });
    const raw = JSON.parse(JSON.stringify(marker)) as Record<string, unknown>;
    const parsed = parseKnowledgeNoChangesCommitMarker(raw);
    if (!parsed.ok) throw new Error("Expected the strict marker to parse");

    expect(parsed.value).not.toBe(raw);
    expect(parsed.value.baseGeneratedPages).not.toBe(raw.baseGeneratedPages);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.baseGeneratedPages)).toBe(true);
    expect(parseKnowledgeNoChangesCommitMarker({ ...raw, unsupported: true }).ok).toBe(false);
  });

  it("rejects mismatched claims and invalid marker timing or Manifest advancement", () => {
    const plan = createPlan();
    const claim = {
      jobId: "job-1",
      sourceId: plan.sourceId,
      sourceContentHash: plan.sourceContentHash,
      pipelineFingerprint: plan.pipelineFingerprint,
      inputRevision: plan.inputRevision,
      attempt: 1,
      startedAt: 100,
    };

    expect(() =>
      createKnowledgeNoChangesCommitMarker({
        plan,
        jobClaim: { ...claim, sourceContentHash: "8".repeat(64) },
        completedAt: 110,
        manifestAfterRevision: 5,
      })
    ).toThrow(NoChangesManifestCommitValidationError);
    expect(() =>
      createKnowledgeNoChangesCommitMarker({
        plan,
        jobClaim: claim,
        completedAt: 99,
        manifestAfterRevision: 5,
      })
    ).toThrow(NoChangesManifestCommitValidationError);
    expect(() =>
      createKnowledgeNoChangesCommitMarker({
        plan,
        jobClaim: claim,
        completedAt: 110,
        manifestAfterRevision: 6,
      })
    ).toThrow(NoChangesManifestCommitValidationError);
  });

  it("detects marker plan-digest and derived-identity tampering", () => {
    const plan = createPlan();
    const marker = createKnowledgeNoChangesCommitMarker({
      plan,
      jobClaim: {
        jobId: "job-1",
        sourceId: plan.sourceId,
        sourceContentHash: plan.sourceContentHash,
        pipelineFingerprint: plan.pipelineFingerprint,
        inputRevision: plan.inputRevision,
        attempt: 1,
        startedAt: 100,
      },
      completedAt: 110,
      manifestAfterRevision: 5,
    });

    expect(
      validateNoChangesManifestCommitMarker({ ...marker, planDigest: "7".repeat(64) })
    ).toMatchObject({ valid: false });
    expect(
      validateNoChangesManifestCommitMarker({
        ...marker,
        noChangesId: `knowledge-no-changes-${"0".repeat(64)}`,
      })
    ).toMatchObject({ valid: false });
  });
});
