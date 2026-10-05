import {
  createKnowledgeSourceOriginExtensions,
  deriveKnowledgeSourceCompileAuthority,
} from "@/knowledge/capture/KnowledgeSourceOrigin";
import {
  MAX_NO_CHANGES_EVIDENCE_COVERAGE_ITEMS,
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
  type NoChangesManifestCommitMarker,
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
  describe("createNoChangesManifestCommitPlan()", () => {
    it("keeps evidence coverage absent on legacy plans without changing their exact identity — https://github.com/yydspanda/obsidian-copilot/issues/17", () => {
      const plan = createPlan();
      const parsed = parseNoChangesManifestCommitPlan(JSON.parse(JSON.stringify(plan)));

      expect(plan).not.toHaveProperty("evidenceCoverage");
      expect(plan.noChangesId).toBe(
        "knowledge-no-changes-d11289a51680c0920951aad8c0f6e9f4dc3740caaa2faf0bd4989d0fa9701eb0"
      );
      expect(createNoChangesManifestCommitPlanDigest(plan)).toBe(
        "1218eeb5e4dca5934d78c0803320ce6de8f465165a0e299fc0d28d22fb636809"
      );
      expect(parsed).toEqual({ ok: true, value: plan });
      if (!parsed.ok) throw new Error("Expected the legacy plan to parse");
      expect(parsed.value).not.toHaveProperty("evidenceCoverage");
    });

    it("retains detached frozen per-evidence counts in source order even when quote hashes repeat — https://github.com/yydspanda/obsidian-copilot/issues/17", () => {
      const evidenceCoverage = [
        { quoteHash: SOURCE_HASH, supportingClaimCount: 2, targetClaimCount: 1 },
        { quoteHash: SOURCE_HASH, supportingClaimCount: 0, targetClaimCount: 0 },
      ];
      const input = { ...createPlanInput(), evidenceCoverage };
      const plan = createPlan(input);
      const coverage = plan.evidenceCoverage;

      expect(coverage).toEqual(evidenceCoverage);
      expect(coverage).not.toBe(evidenceCoverage);
      expect(Object.isFrozen(coverage)).toBe(true);
      expect(coverage?.every(Object.isFrozen)).toBe(true);
      evidenceCoverage[0].targetClaimCount = 2;
      evidenceCoverage.reverse();
      expect(plan).toHaveProperty("evidenceCoverage", [
        { quoteHash: SOURCE_HASH, supportingClaimCount: 2, targetClaimCount: 1 },
        { quoteHash: SOURCE_HASH, supportingClaimCount: 0, targetClaimCount: 0 },
      ]);
      expect(plan.noChangesId).not.toBe(createPlan().noChangesId);
      expect(createNoChangesManifestCommitPlanDigest(plan)).not.toBe(
        createNoChangesManifestCommitPlanDigest(createPlan())
      );
    });

    it("accepts the bounded maximum evidence count and safe claim counts — https://github.com/yydspanda/obsidian-copilot/issues/17", () => {
      expect(MAX_NO_CHANGES_EVIDENCE_COVERAGE_ITEMS).toBe(2048);
      const evidenceCoverage = Array.from(
        { length: MAX_NO_CHANGES_EVIDENCE_COVERAGE_ITEMS },
        () => ({
          quoteHash: SOURCE_HASH,
          supportingClaimCount: Number.MAX_SAFE_INTEGER,
          targetClaimCount: Number.MAX_SAFE_INTEGER,
        })
      );
      const input = { ...createPlanInput(), evidenceCoverage };

      expect(createPlan(input)).toHaveProperty("evidenceCoverage", evidenceCoverage);
    });

    it.each([
      { condition: "an empty array", evidenceCoverage: [] },
      {
        condition: "more than 2048 entries",
        evidenceCoverage: Array.from({ length: 2049 }, () => ({
          quoteHash: SOURCE_HASH,
          supportingClaimCount: 1,
          targetClaimCount: 0,
        })),
      },
      {
        condition: "a malformed quote hash",
        evidenceCoverage: [
          { quoteHash: "not-a-hash", supportingClaimCount: 1, targetClaimCount: 0 },
        ],
      },
      {
        condition: "a negative supporting count",
        evidenceCoverage: [
          { quoteHash: SOURCE_HASH, supportingClaimCount: -1, targetClaimCount: 0 },
        ],
      },
      {
        condition: "a fractional supporting count",
        evidenceCoverage: [
          { quoteHash: SOURCE_HASH, supportingClaimCount: 0.5, targetClaimCount: 0 },
        ],
      },
      {
        condition: "an unsafe supporting count",
        evidenceCoverage: [
          {
            quoteHash: SOURCE_HASH,
            supportingClaimCount: Number.MAX_SAFE_INTEGER + 1,
            targetClaimCount: 0,
          },
        ],
      },
      {
        condition: "a negative target count",
        evidenceCoverage: [
          { quoteHash: SOURCE_HASH, supportingClaimCount: 1, targetClaimCount: -1 },
        ],
      },
      {
        condition: "a fractional target count",
        evidenceCoverage: [
          { quoteHash: SOURCE_HASH, supportingClaimCount: 1, targetClaimCount: 0.5 },
        ],
      },
      {
        condition: "an unsafe target count",
        evidenceCoverage: [
          {
            quoteHash: SOURCE_HASH,
            supportingClaimCount: 1,
            targetClaimCount: Number.MAX_SAFE_INTEGER + 1,
          },
        ],
      },
      {
        condition: "a target count above the supporting count",
        evidenceCoverage: [
          { quoteHash: SOURCE_HASH, supportingClaimCount: 1, targetClaimCount: 2 },
        ],
      },
      {
        condition: "private text in an unsupported field",
        evidenceCoverage: [
          {
            quoteHash: SOURCE_HASH,
            supportingClaimCount: 1,
            targetClaimCount: 0,
            excerpt: "private source text",
          },
        ],
      },
    ])(
      "rejects evidence coverage containing $condition — https://github.com/yydspanda/obsidian-copilot/issues/17",
      ({ evidenceCoverage }) => {
        const input = { ...createPlanInput(), evidenceCoverage };

        expect(() => createPlan(input)).toThrow(NoChangesManifestCommitValidationError);
      }
    );

    it("preserves absent diagnostics and the exact legacy identity — https://github.com/yydspanda/obsidian-copilot/issues/15", () => {
      const plan = createPlan();

      expect(plan).not.toHaveProperty("generationOutcomes");
      expect(plan.noChangesId).toBe(
        "knowledge-no-changes-d11289a51680c0920951aad8c0f6e9f4dc3740caaa2faf0bd4989d0fa9701eb0"
      );
      expect(createNoChangesManifestCommitPlanDigest(plan)).toBe(
        "1218eeb5e4dca5934d78c0803320ce6de8f465165a0e299fc0d28d22fb636809"
      );
      const parsed = parseNoChangesManifestCommitPlan(JSON.parse(JSON.stringify(plan)));
      expect(parsed).toEqual({ ok: true, value: plan });
    });

    it("retains detached frozen generation counts in the content-addressed plan — https://github.com/yydspanda/obsidian-copilot/issues/15", () => {
      const generationOutcomes = { explicitUnchanged: 2, identicalWrites: 1 };
      const plan = createPlan({ generationOutcomes });

      expect(plan).toHaveProperty("generationOutcomes", generationOutcomes);
      expect(Object.isFrozen(plan.generationOutcomes)).toBe(true);
      generationOutcomes.explicitUnchanged = 9;
      expect(plan).toHaveProperty("generationOutcomes", {
        explicitUnchanged: 2,
        identicalWrites: 1,
      });
      expect(plan.noChangesId).not.toBe(createPlan().noChangesId);
      expect(createNoChangesManifestCommitPlanDigest(plan)).not.toBe(
        createNoChangesManifestCommitPlanDigest(createPlan())
      );
      expect(
        validateNoChangesManifestCommitPlan({
          ...plan,
          generationOutcomes: { explicitUnchanged: 1, identicalWrites: 2 },
        }).valid
      ).toBe(false);
    });

    it.each([
      { explicitUnchanged: -1, identicalWrites: 1 },
      { explicitUnchanged: 0.5, identicalWrites: 1 },
      { explicitUnchanged: Number.MAX_SAFE_INTEGER + 1, identicalWrites: 0 },
      { explicitUnchanged: Number.MAX_SAFE_INTEGER, identicalWrites: 1 },
      { explicitUnchanged: 0, identicalWrites: 0 },
      { explicitUnchanged: 1, identicalWrites: 0, content: "private model text" },
    ])(
      "rejects invalid or non-count generation diagnostics %j — https://github.com/yydspanda/obsidian-copilot/issues/15",
      (generationOutcomes) => {
        expect(() => createPlan({ generationOutcomes })).toThrow(
          NoChangesManifestCommitValidationError
        );
      }
    );

    it.each<NoChangesManifestCommitReason>(["analysis_no_targets", "resolved_no_targets"])(
      "rejects generation counts on the earlier %s outcome — https://github.com/yydspanda/obsidian-copilot/issues/15",
      (reason) => {
        expect(() =>
          createPlan({
            reason,
            generationOutcomes: { explicitUnchanged: 1, identicalWrites: 0 },
          })
        ).toThrow(NoChangesManifestCommitValidationError);
      }
    );
  });

  describe("createKnowledgeNoChangesCommitMarker()", () => {
    it("persists detached frozen evidence coverage through marker reload and rejects tampering — https://github.com/yydspanda/obsidian-copilot/issues/17", () => {
      const input = {
        ...createPlanInput(),
        evidenceCoverage: [
          { quoteHash: SOURCE_HASH, supportingClaimCount: 2, targetClaimCount: 1 },
          { quoteHash: PIPELINE_HASH, supportingClaimCount: 0, targetClaimCount: 0 },
        ],
      };
      const plan = createPlan(input);
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
      const raw = JSON.parse(JSON.stringify(marker)) as NoChangesManifestCommitMarker;
      const parsed = parseKnowledgeNoChangesCommitMarker(raw);
      if (!parsed.ok) throw new Error("Expected evidence coverage to survive marker reload");
      const coverage = parsed.value.evidenceCoverage;

      expect(coverage).toEqual(input.evidenceCoverage);
      expect(coverage).not.toBe(raw.evidenceCoverage);
      expect(Object.isFrozen(coverage)).toBe(true);
      expect(coverage?.every(Object.isFrozen)).toBe(true);
      expect(marker.evidenceCoverage).not.toBe(plan.evidenceCoverage);
      expect(Object.isFrozen(marker.evidenceCoverage)).toBe(true);
      expect(marker.evidenceCoverage?.every(Object.isFrozen)).toBe(true);
      expect(validateNoChangesManifestCommitMarker(parsed.value).valid).toBe(true);
      for (const evidenceCoverage of [
        [{ ...input.evidenceCoverage[0], supportingClaimCount: 3 }, input.evidenceCoverage[1]],
        [{ ...input.evidenceCoverage[0], targetClaimCount: 2 }, input.evidenceCoverage[1]],
        [{ ...input.evidenceCoverage[0], quoteHash: PAGE_HASH }, input.evidenceCoverage[1]],
        [...input.evidenceCoverage].reverse(),
      ]) {
        expect(validateNoChangesManifestCommitPlan({ ...plan, evidenceCoverage }).valid).toBe(
          false
        );
        expect(
          validateNoChangesManifestCommitMarker({ ...parsed.value, evidenceCoverage }).valid
        ).toBe(false);
      }
    });

    it("persists generation diagnostics through strict marker serialization and rejects altered counts — https://github.com/yydspanda/obsidian-copilot/issues/15", () => {
      const plan = createPlan({
        generationOutcomes: { explicitUnchanged: 1, identicalWrites: 1 },
      });
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
      const parsed = parseKnowledgeNoChangesCommitMarker(JSON.parse(JSON.stringify(marker)));
      if (!parsed.ok) throw new Error("Expected generation diagnostics to survive marker reload");

      expect(parsed.value).toHaveProperty("generationOutcomes", {
        explicitUnchanged: 1,
        identicalWrites: 1,
      });
      expect(Object.isFrozen(parsed.value.generationOutcomes)).toBe(true);
      expect(validateNoChangesManifestCommitMarker(parsed.value).valid).toBe(true);
      expect(
        validateNoChangesManifestCommitMarker({
          ...parsed.value,
          generationOutcomes: { explicitUnchanged: 2, identicalWrites: 0 },
        }).valid
      ).toBe(false);
    });
  });

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
