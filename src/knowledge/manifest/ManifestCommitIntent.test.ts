import {
  MANIFEST_COMMIT_INTENT_VERSION,
  MANIFEST_COMMIT_PLAN_VERSION,
  ManifestCommitValidationError,
  createManifestCommitIntentDigest,
  createManifestCommitPlan,
  createManifestCommitPlanDigest,
  createSourceManifestDigest,
  manifestCommitIntentSchema,
  manifestCommitPlanSchema,
  parseManifestCommitIntent,
  parseManifestCommitPlan,
  projectManifestCommitIntent,
  validateManifestCommitIntent,
  validateManifestCommitIntentAgainstManifest,
  validateManifestCommitIntentForCommit,
  validateManifestCommitPlan,
  validateManifestCommitPlanForChangeSet,
  type ManifestCommitIntent,
  type ManifestCommitMutation,
  type ManifestCommitPage,
  type ManifestCommitPlan,
} from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeFileChange,
  SourceManifest,
  SourceManifestEntry,
} from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const SOURCE_HASH = "a".repeat(64);
const PIPELINE_HASH = "b".repeat(64);
const ALPHA_CONTENT = "# Alpha\n";
const ALPHA_HASH = createFileContentHash(ALPHA_CONTENT);
const UNTOUCHED_CONTENT = "# Untouched\n";
const UNTOUCHED_HASH = createFileContentHash(UNTOUCHED_CONTENT);
const NEW_CONTENT = "# New\n";
const NEW_HASH = createFileContentHash(NEW_CONTENT);
const UPDATED_CONTENT = "# Updated\n";
const UPDATED_HASH = createFileContentHash(UPDATED_CONTENT);
const REVIEWED_CONTENT = "# Reviewed\n";
const REVIEWED_HASH = createFileContentHash(REVIEWED_CONTENT);

/** Creates the canonical Windows-only Bundle used by domain tests. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "personal",
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Config/knowledge-schema.md",
    reviewMode: "always",
  };
}

/** Creates one complete Manifest page with a required content hash. */
function createPage(
  path: string,
  contentHash: string,
  ownership: ManifestCommitPage["ownership"] = "generated"
): ManifestCommitPage {
  return { path, ownership, contentHash };
}

/** Creates one registered source entry with an optional successful projection. */
function createSourceEntry(
  sourceId: string,
  sourcePath: string,
  pages?: Array<{
    path: string;
    ownership: ManifestCommitPage["ownership"];
    contentHash?: string;
  }>
): SourceManifestEntry {
  return {
    sourceId,
    sourcePath,
    sourceKey: toWindowsPathKey(sourcePath),
    custody: "user_managed",
    ...(pages === undefined
      ? {}
      : {
          lastSuccessful: {
            sourceContentHash: SOURCE_HASH,
            pipelineFingerprint: PIPELINE_HASH,
            generatedPages: pages,
            changeSetId: "changeset-previous",
            completedAt: 100,
          },
        }),
  };
}

/** Creates an exact Source Manifest with replaceable entries and revision. */
function createManifest(
  entries: SourceManifestEntry[] = [
    createSourceEntry("source-1", "Sources/Primary.md", [
      createPage("Wiki/Alpha.md", ALPHA_HASH),
      createPage("Wiki/Untouched.md", UNTOUCHED_HASH, "user"),
    ]),
  ],
  revision = 4
): SourceManifest {
  return { version: 1, bundleId: "personal", revision, entries };
}

/** Creates one create file change whose after hash matches exact content. */
function createCreateChange(
  id = "change-create",
  path = "Wiki/New.md",
  content = NEW_CONTENT
): KnowledgeFileChange {
  return {
    id,
    path,
    operation: "create",
    expectedAbsent: true,
    afterContent: content,
    afterHash: createFileContentHash(content),
    sourceRefs: ["source-1"],
    reason: "Create a grounded Wiki page",
  };
}

/** Creates one update file change with exact before and after hashes. */
function createUpdateChange(
  id = "change-update",
  path = "Wiki/Alpha.md",
  content = UPDATED_CONTENT,
  beforeHash = ALPHA_HASH
): KnowledgeFileChange {
  return {
    id,
    path,
    operation: "update",
    beforeHash,
    afterContent: content,
    afterHash: createFileContentHash(content),
    sourceRefs: ["source-1"],
    reason: "Update a grounded Wiki page",
  };
}

/** Creates one delete file change bound to a last-generated hash. */
function createDeleteChange(
  id = "change-delete",
  path = "Wiki/Alpha.md",
  beforeHash = ALPHA_HASH
): KnowledgeFileChange {
  return {
    id,
    path,
    operation: "delete",
    beforeHash,
    sourceRefs: ["source-1"],
    reason: "Remove an obsolete generated page",
  };
}

/** Creates a semantically valid proposal or accepted ingest ChangeSet. */
function createChangeSet(
  changes: KnowledgeFileChange[],
  status: KnowledgeChangeSet["status"] = "proposed",
  overrides: Partial<KnowledgeChangeSet> = {}
): KnowledgeChangeSet {
  return {
    id: "changeset-current",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes,
    citations: [],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status,
    createdAt: 1_000,
    ...overrides,
  };
}

/** Creates the resolved Manifest mutation paired with one file change. */
function createMutation(
  change: KnowledgeFileChange,
  ownership: ManifestCommitMutation["ownership"],
  wasTrackedByPrimarySource: boolean
): ManifestCommitMutation {
  return {
    changeId: change.id,
    path: change.path,
    operation: change.operation,
    access: wasTrackedByPrimarySource ? "authorized" : "create_only",
    ownership,
    wasTrackedByPrimarySource,
  };
}

/** Builds a valid plan for one exact proposal using the standard fixtures. */
function createPlan(
  changeSet: KnowledgeChangeSet,
  mutations: readonly ManifestCommitMutation[],
  manifest = createManifest()
): ManifestCommitPlan {
  return createManifestCommitPlan({
    bundle: createBundle(),
    manifest,
    sourceId: "source-1",
    sourceContentHash: SOURCE_HASH,
    pipelineFingerprint: PIPELINE_HASH,
    inputRevision: 7,
    changeSet,
    mutations,
  });
}

/** Returns stable diagnostic codes from one public validation result. */
function diagnosticCodes(result: { diagnostics: readonly { code: string }[] }): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

/** Requires one callback to fail with a selected typed diagnostic code. */
function expectManifestFailure(invoke: () => unknown, code: string): void {
  try {
    invoke();
    throw new Error("Expected Manifest commit validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ManifestCommitValidationError);
    if (!(error instanceof ManifestCommitValidationError)) {
      throw error;
    }
    expect(diagnosticCodes(error)).toContain(code);
  }
}

describe("ManifestCommitIntent strict contracts", () => {
  it("exports composable strict schemas and detached parse results", () => {
    const change = createCreateChange();
    const proposal = createChangeSet([change]);
    const plan = createPlan(proposal, [createMutation(change, "generated", false)]);
    const accepted = createChangeSet([change], "accepted");
    const intent = projectManifestCommitIntent(plan, accepted);

    expect(MANIFEST_COMMIT_PLAN_VERSION).toBe(1);
    expect(MANIFEST_COMMIT_INTENT_VERSION).toBe(1);
    expect(manifestCommitPlanSchema.safeParse(plan).success).toBe(true);
    expect(manifestCommitIntentSchema.safeParse(intent).success).toBe(true);
    expect(parseManifestCommitPlan(plan)).toEqual({ ok: true, value: plan });
    expect(parseManifestCommitIntent(intent)).toEqual({ ok: true, value: intent });

    const parsed = parseManifestCommitPlan(plan);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      parsed.value.baseGeneratedPages[0].path = "Wiki/Mutated.md";
    }
    expect(plan.baseGeneratedPages[0].path).toBe("Wiki/Alpha.md");
  });

  it("rejects unknown keys, versions, invalid source identity, optional page hashes, and an empty final projection", () => {
    const change = createCreateChange();
    const proposal = createChangeSet([change]);
    const plan = createPlan(proposal, [createMutation(change, "generated", false)]);
    const accepted = createChangeSet([change], "accepted");
    const intent = projectManifestCommitIntent(plan, accepted);

    expect(parseManifestCommitPlan({ ...plan, unexpected: true }).ok).toBe(false);
    expect(parseManifestCommitPlan({ ...plan, version: 2 }).ok).toBe(false);
    expect(parseManifestCommitPlan({ ...plan, sourceContentHash: "not-a-hash" }).ok).toBe(false);
    expect(parseManifestCommitPlan({ ...plan, pipelineFingerprint: "not-a-hash" }).ok).toBe(false);
    expect(
      parseManifestCommitPlan({
        ...plan,
        baseGeneratedPages: [{ path: "Wiki/Alpha.md", ownership: "generated" }],
      }).ok
    ).toBe(false);
    expect(parseManifestCommitIntent({ ...intent, unexpected: true }).ok).toBe(false);
    expect(parseManifestCommitIntent({ ...intent, sourceContentHash: "not-a-hash" }).ok).toBe(
      false
    );
    expect(parseManifestCommitIntent({ ...intent, pipelineFingerprint: "not-a-hash" }).ok).toBe(
      false
    );
    expect(
      parseManifestCommitIntent({ ...intent, manifestCommitPlanDigest: "not-a-hash" }).ok
    ).toBe(false);
    expect(parseManifestCommitIntent({ ...intent, generatedPages: [] }).ok).toBe(false);
  });

  it("rejects Windows collisions, noncanonical order, overlap, and Bundle boundary escapes", () => {
    const change = createCreateChange();
    const proposal = createChangeSet([change]);
    const valid = createPlan(proposal, [createMutation(change, "generated", false)]);
    const collision: ManifestCommitPlan = {
      ...valid,
      baseGeneratedPages: [
        createPage("Wiki/Alpha.md", ALPHA_HASH),
        createPage("wiki/ALPHA.md", UNTOUCHED_HASH),
      ],
    };
    const reversed: ManifestCommitPlan = {
      ...valid,
      baseGeneratedPages: [...valid.baseGeneratedPages].reverse(),
    };
    const overlap: ManifestCommitPlan = {
      ...valid,
      baseGeneratedPages: [
        createPage("Wiki/Folder.md", ALPHA_HASH),
        createPage("Wiki/Folder.md/Child.md", UNTOUCHED_HASH),
      ],
    };
    const outside: ManifestCommitPlan = {
      ...valid,
      baseGeneratedPages: [createPage("Other/Page.md", ALPHA_HASH)],
    };

    expect(diagnosticCodes(validateManifestCommitPlan(collision))).toContain(
      "manifest_commit_page_windows_collision"
    );
    expect(diagnosticCodes(validateManifestCommitPlan(reversed))).toContain(
      "manifest_commit_pages_not_canonical"
    );
    expect(diagnosticCodes(validateManifestCommitPlan(overlap))).toContain(
      "manifest_commit_page_path_overlap"
    );
    expect(diagnosticCodes(validateManifestCommitPlan(outside, createBundle()))).toContain(
      "manifest_commit_path_outside_wiki"
    );
  });
});

describe("Manifest commit digests", () => {
  it("uses stable domain-separated identities for Manifest, plan, and intent", () => {
    const change = createCreateChange();
    const proposal = createChangeSet([change]);
    const plan = createPlan(proposal, [createMutation(change, "generated", false)]);
    const intent = projectManifestCommitIntent(plan, createChangeSet([change], "accepted"));
    const manifest = createManifest();

    expect(createSourceManifestDigest(manifest)).toMatch(/^[a-f0-9]{64}$/);
    expect(createSourceManifestDigest({ ...manifest })).toBe(createSourceManifestDigest(manifest));
    expect(createManifestCommitPlanDigest(plan)).toBe(createManifestCommitPlanDigest({ ...plan }));
    expect(createManifestCommitIntentDigest(intent)).toBe(
      createManifestCommitIntentDigest({ ...intent })
    );
    expect(createManifestCommitPlanDigest(plan)).not.toBe(
      createManifestCommitPlanDigest({ ...plan, inputRevision: plan.inputRevision + 1 })
    );
    expect(createManifestCommitPlanDigest(plan)).not.toBe(createManifestCommitIntentDigest(intent));
  });
});

describe("createManifestCommitPlan", () => {
  it("captures the exact read-set and canonical complete primary base", () => {
    const manifest = createManifest([
      createSourceEntry("source-1", "Sources/Primary.md", [
        createPage("Wiki/Untouched.md", UNTOUCHED_HASH, "user"),
        createPage("Wiki/Alpha.md", ALPHA_HASH),
      ]),
    ]);
    const update = createUpdateChange();
    const create = createCreateChange();
    const proposal = createChangeSet([create, update]);
    const plan = createPlan(
      proposal,
      [createMutation(create, "generated", false), createMutation(update, "generated", true)],
      manifest
    );

    expect(plan).toMatchObject({
      version: 1,
      kind: "source_compile",
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_HASH,
      inputRevision: 7,
      changeSetId: proposal.id,
      expectedManifestRevision: manifest.revision,
      expectedManifestDigest: createSourceManifestDigest(manifest),
    });
    expect(plan.baseGeneratedPages.map((page) => page.path)).toEqual([
      "Wiki/Alpha.md",
      "Wiki/Untouched.md",
    ]);
    expect(plan.mutations.map((mutation) => mutation.path)).toEqual([
      "Wiki/Alpha.md",
      "Wiki/New.md",
    ]);
    expect(validateManifestCommitPlanForChangeSet(plan, proposal, createBundle()).valid).toBe(true);
  });

  it("fails closed when a previous page has no last-generated hash", () => {
    const manifest = createManifest([
      createSourceEntry("source-1", "Sources/Primary.md", [
        { path: "Wiki/Alpha.md", ownership: "generated" },
      ]),
    ]);
    const update = createUpdateChange();
    const proposal = createChangeSet([update]);

    expectManifestFailure(
      () => createPlan(proposal, [createMutation(update, "generated", true)], manifest),
      "manifest_commit_base_hash_missing"
    );
  });

  it("rejects create-only authority for every Manifest-tracked target", () => {
    const update = createUpdateChange();
    const proposal = createChangeSet([update]);
    const forgedAuthority = {
      ...createMutation(update, "generated", true),
      access: "create_only" as const,
    };

    expectManifestFailure(
      () => createPlan(proposal, [forgedAuthority]),
      "manifest_commit_tracked_authority_missing"
    );
  });

  it("rejects untracked existing updates and cross-source create claims", () => {
    const update = createUpdateChange("change-external", "Wiki/External.md", UPDATED_CONTENT);
    const updateProposal = createChangeSet([update]);
    expectManifestFailure(
      () => createPlan(updateProposal, [createMutation(update, "generated", false)]),
      "manifest_commit_existing_not_primary_tracked"
    );

    const create = createCreateChange("change-cross", "Wiki/Cross.md");
    const crossManifest = createManifest([
      createSourceEntry("source-1", "Sources/Primary.md", [
        createPage("Wiki/Alpha.md", ALPHA_HASH),
      ]),
      createSourceEntry("source-2", "Sources/Other.md", [
        createPage("Wiki/Cross.md", NEW_HASH, "shared"),
      ]),
    ]);
    expectManifestFailure(
      () =>
        createPlan(
          createChangeSet([create]),
          [createMutation(create, "generated", false)],
          crossManifest
        ),
      "manifest_commit_cross_source_existing_page"
    );
  });

  it("requires co-owned pages and their source provenance to remain consistent", () => {
    const sharedUpdate = {
      ...createUpdateChange(),
      sourceRefs: ["source-1", "source-2"],
    };
    const proposal = createChangeSet([sharedUpdate], "proposed", {
      sourceRefs: ["source-1", "source-2"],
    });
    const sharedManifest = createManifest([
      createSourceEntry("source-1", "Sources/Primary.md", [
        createPage("Wiki/Alpha.md", ALPHA_HASH, "shared"),
      ]),
      createSourceEntry("source-2", "Sources/Other.md", [
        createPage("Wiki/Alpha.md", ALPHA_HASH, "shared"),
      ]),
    ]);

    expect(
      createPlan(proposal, [createMutation(sharedUpdate, "shared", true)], sharedManifest)
    ).toMatchObject({ sourceId: "source-1" });

    const divergentManifest = createManifest([
      createSourceEntry("source-1", "Sources/Primary.md", [
        createPage("Wiki/Alpha.md", ALPHA_HASH, "shared"),
      ]),
      createSourceEntry("source-2", "Sources/Other.md", [
        createPage("Wiki/Alpha.md", NEW_HASH, "shared"),
      ]),
    ]);
    expectManifestFailure(
      () => createPlan(proposal, [createMutation(sharedUpdate, "shared", true)], divergentManifest),
      "manifest_commit_coowner_page_mismatch"
    );

    const missingOwnerRef = { ...sharedUpdate, sourceRefs: ["source-1"] };
    expectManifestFailure(
      () =>
        createPlan(
          createChangeSet([missingOwnerRef]),
          [createMutation(missingOwnerRef, "shared", true)],
          sharedManifest
        ),
      "manifest_commit_coowner_source_missing"
    );
  });

  it("requires generated ownership for new pages and sole generated ownership for deletes", () => {
    const create = createCreateChange();
    expectManifestFailure(
      () => createPlan(createChangeSet([create]), [createMutation(create, "shared", false)]),
      "manifest_commit_new_ownership_invalid"
    );

    const userManifest = createManifest([
      createSourceEntry("source-1", "Sources/Primary.md", [
        createPage("Wiki/Alpha.md", ALPHA_HASH, "user"),
        createPage("Wiki/Untouched.md", UNTOUCHED_HASH),
      ]),
    ]);
    const deletion = createDeleteChange();
    expectManifestFailure(
      () =>
        createPlan(
          createChangeSet([deletion]),
          [createMutation(deletion, "user", true)],
          userManifest
        ),
      "manifest_commit_delete_ownership_invalid"
    );
  });
});

describe("projectManifestCommitIntent", () => {
  it("uses accepted rewrites, retains untouched and rejected pages, and canonicalizes output", () => {
    const update = createUpdateChange();
    const create = createCreateChange();
    const proposal = createChangeSet([create, update]);
    const plan = createPlan(proposal, [
      createMutation(create, "generated", false),
      createMutation(update, "generated", true),
    ]);
    const reviewedUpdate = createUpdateChange(update.id, update.path, REVIEWED_CONTENT, ALPHA_HASH);
    const accepted = createChangeSet([reviewedUpdate], "accepted");

    const intent = projectManifestCommitIntent(plan, accepted);

    expect(intent.generatedPages).toEqual([
      createPage("Wiki/Alpha.md", REVIEWED_HASH),
      createPage("Wiki/Untouched.md", UNTOUCHED_HASH, "user"),
    ]);
    expect(intent.generatedPages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "Wiki/New.md" })])
    );
    expect(validateManifestCommitIntent(intent, createBundle()).valid).toBe(true);
  });

  it("preserves ownership and canonical resolver spelling when recreating a tracked missing page", () => {
    const manifest = createManifest([
      createSourceEntry("source-1", "Sources/Primary.md", [
        createPage("Wiki/Missing.md", ALPHA_HASH, "user"),
      ]),
    ]);
    const recreate = createCreateChange("change-recreate", "wiki/MISSING.md", NEW_CONTENT);
    const proposal = createChangeSet([recreate]);
    const plan = createPlan(proposal, [createMutation(recreate, "user", true)], manifest);

    const intent = projectManifestCommitIntent(plan, createChangeSet([recreate], "accepted"));

    expect(intent.generatedPages).toEqual([createPage("wiki/MISSING.md", NEW_HASH, "user")]);
  });

  it("rejects stale accepted update hashes and deletion of the last page", () => {
    const update = createUpdateChange();
    const updatePlan = createPlan(createChangeSet([update]), [
      createMutation(update, "generated", true),
    ]);
    const staleUpdate = createUpdateChange(update.id, update.path, UPDATED_CONTENT, "f".repeat(64));
    expectManifestFailure(
      () => projectManifestCommitIntent(updatePlan, createChangeSet([staleUpdate], "accepted")),
      "manifest_commit_update_hash_mismatch"
    );

    const staleDeletion = createDeleteChange(
      "change-stale-delete",
      "Wiki/Alpha.md",
      "f".repeat(64)
    );
    const staleDeletePlan = createPlan(createChangeSet([staleDeletion]), [
      createMutation(staleDeletion, "generated", true),
    ]);
    expectManifestFailure(
      () =>
        projectManifestCommitIntent(staleDeletePlan, createChangeSet([staleDeletion], "accepted")),
      "manifest_commit_delete_hash_mismatch"
    );

    const onePageManifest = createManifest([
      createSourceEntry("source-1", "Sources/Primary.md", [
        createPage("Wiki/Alpha.md", ALPHA_HASH),
      ]),
    ]);
    const deletion = createDeleteChange();
    const deletePlan = createPlan(
      createChangeSet([deletion]),
      [createMutation(deletion, "generated", true)],
      onePageManifest
    );
    expectManifestFailure(
      () => projectManifestCommitIntent(deletePlan, createChangeSet([deletion], "accepted")),
      "manifest_commit_pages_empty"
    );
  });
});

describe("Manifest commit-time reconstruction", () => {
  it("rebuilds and validates a full final projection from the actual Manifest", () => {
    const manifest = createManifest();
    const update = createUpdateChange();
    const create = createCreateChange();
    const proposal = createChangeSet([update, create]);
    const plan = createPlan(
      proposal,
      [createMutation(update, "generated", true), createMutation(create, "generated", false)],
      manifest
    );
    const accepted = createChangeSet([update, create], "accepted");
    const intent = projectManifestCommitIntent(plan, accepted);

    expect(
      validateManifestCommitIntentForCommit(intent, manifest, accepted, createBundle()).valid
    ).toBe(true);
    expect(
      validateManifestCommitIntentAgainstManifest(intent, plan, manifest, accepted, createBundle())
        .valid
    ).toBe(true);
  });

  it("rejects stale Manifest revision/digest and a tampered final page set", () => {
    const manifest = createManifest();
    const update = createUpdateChange();
    const proposal = createChangeSet([update]);
    const plan = createPlan(proposal, [createMutation(update, "generated", true)], manifest);
    const accepted = createChangeSet([update], "accepted");
    const intent = projectManifestCommitIntent(plan, accepted);
    const staleManifest = { ...manifest, revision: manifest.revision + 1 };
    const stale = validateManifestCommitIntentForCommit(
      intent,
      staleManifest,
      accepted,
      createBundle()
    );
    const tampered: ManifestCommitIntent = {
      ...intent,
      generatedPages: intent.generatedPages.map((page) =>
        page.path === "Wiki/Alpha.md" ? { ...page, contentHash: "f".repeat(64) } : page
      ),
    };

    expect(diagnosticCodes(stale)).toEqual(
      expect.arrayContaining([
        "manifest_commit_revision_mismatch",
        "manifest_commit_digest_mismatch",
      ])
    );
    expect(
      diagnosticCodes(
        validateManifestCommitIntentForCommit(tampered, manifest, accepted, createBundle())
      )
    ).toContain("manifest_commit_final_projection_mismatch");
  });

  it("requires update beforeHash to equal the primary Manifest last-generated hash", () => {
    const manifest = createManifest();
    const exactUpdate = createUpdateChange();
    const proposal = createChangeSet([exactUpdate]);
    const plan = createPlan(proposal, [createMutation(exactUpdate, "generated", true)], manifest);
    const exactAccepted = createChangeSet([exactUpdate], "accepted");
    const intent = projectManifestCommitIntent(plan, exactAccepted);
    const staleUpdate = createUpdateChange(
      exactUpdate.id,
      exactUpdate.path,
      UPDATED_CONTENT,
      "f".repeat(64)
    );
    const staleAccepted = createChangeSet([staleUpdate], "accepted");

    expect(
      diagnosticCodes(
        validateManifestCommitIntentForCommit(intent, manifest, staleAccepted, createBundle())
      )
    ).toContain("manifest_commit_update_hash_mismatch");
  });

  it("rejects an untracked existing update and a create tracked by another source", () => {
    const manifest = createManifest([
      createSourceEntry("source-1", "Sources/Primary.md", [
        createPage("Wiki/Alpha.md", ALPHA_HASH),
      ]),
      createSourceEntry("source-2", "Sources/Other.md", [
        createPage("Wiki/Cross.md", NEW_HASH, "shared"),
      ]),
    ]);
    const externalUpdate = createUpdateChange(
      "change-external",
      "Wiki/External.md",
      UPDATED_CONTENT,
      ALPHA_HASH
    );
    const updateAccepted = createChangeSet([externalUpdate], "accepted");
    const updateIntent: ManifestCommitIntent = {
      version: 1,
      kind: "source_compile",
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: SOURCE_HASH,
      pipelineFingerprint: PIPELINE_HASH,
      inputRevision: 7,
      manifestCommitPlanDigest: "c".repeat(64),
      changeSetId: updateAccepted.id,
      expectedManifestRevision: manifest.revision,
      expectedManifestDigest: createSourceManifestDigest(manifest),
      generatedPages: [
        createPage("Wiki/Alpha.md", ALPHA_HASH),
        createPage("Wiki/External.md", UPDATED_HASH),
      ],
    };
    expect(
      diagnosticCodes(
        validateManifestCommitIntentForCommit(
          updateIntent,
          manifest,
          updateAccepted,
          createBundle()
        )
      )
    ).toContain("manifest_commit_existing_not_primary_tracked");

    const crossCreate = createCreateChange("change-cross", "Wiki/Cross.md");
    const createAccepted = createChangeSet([crossCreate], "accepted");
    const createIntent: ManifestCommitIntent = {
      ...updateIntent,
      changeSetId: createAccepted.id,
      generatedPages: [
        createPage("Wiki/Alpha.md", ALPHA_HASH),
        createPage("Wiki/Cross.md", NEW_HASH),
      ],
    };
    expect(
      diagnosticCodes(
        validateManifestCommitIntentForCommit(
          createIntent,
          manifest,
          createAccepted,
          createBundle()
        )
      )
    ).toContain("manifest_commit_cross_source_existing_page");
  });

  it("validates a consistent co-owned update while allowing additional evidence provenance", () => {
    const manifest = createManifest([
      createSourceEntry("source-1", "Sources/Primary.md", [
        createPage("Wiki/Alpha.md", ALPHA_HASH, "shared"),
      ]),
      createSourceEntry("source-2", "Sources/Other.md", [
        createPage("Wiki/Alpha.md", ALPHA_HASH, "shared"),
      ]),
    ]);
    const update = {
      ...createUpdateChange(),
      sourceRefs: ["evidence-source", "source-1", "source-2"],
    };
    const proposal = createChangeSet([update], "proposed", {
      sourceRefs: ["evidence-source", "source-1", "source-2"],
    });
    const plan = createPlan(proposal, [createMutation(update, "shared", true)], manifest);
    const accepted = createChangeSet([update], "accepted", {
      sourceRefs: proposal.sourceRefs,
    });
    const intent = projectManifestCommitIntent(plan, accepted);

    expect(
      validateManifestCommitIntentForCommit(intent, manifest, accepted, createBundle()).valid
    ).toBe(true);

    const missingCoOwner = {
      ...accepted,
      changes: [{ ...update, sourceRefs: ["source-1"] }],
    };
    expect(
      diagnosticCodes(
        validateManifestCommitIntentForCommit(intent, manifest, missingCoOwner, createBundle())
      )
    ).toContain("manifest_commit_coowner_source_missing");
  });

  it("validates an exact sole-owner delete while retaining another page", () => {
    const manifest = createManifest();
    const deletion = createDeleteChange();
    const proposal = createChangeSet([deletion]);
    const plan = createPlan(proposal, [createMutation(deletion, "generated", true)], manifest);
    const accepted = createChangeSet([deletion], "accepted");
    const intent = projectManifestCommitIntent(plan, accepted);

    expect(intent.generatedPages).toEqual([
      createPage("Wiki/Untouched.md", UNTOUCHED_HASH, "user"),
    ]);
    expect(
      validateManifestCommitIntentForCommit(intent, manifest, accepted, createBundle()).valid
    ).toBe(true);
  });
});
