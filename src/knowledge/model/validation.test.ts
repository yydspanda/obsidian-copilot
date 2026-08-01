import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type {
  ClaimCitation,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeFileChange,
  SourceLocator,
  SourceManifest,
} from "@/knowledge/model/types";
import {
  validateClaimCitation,
  validateKnowledgeBundleConfig,
  validateKnowledgeChangeSet,
  validateKnowledgeFileChange,
  validateKnowledgeIngestJob,
  validateOkfDocument,
  validateSourceLocator,
  validateSourceManifest,
  validateSourceManifestForBundle,
  validateVaultRelativePath,
} from "@/knowledge/model/validation";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/** Creates a valid Windows-only knowledge Bundle. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "personal",
    sourceRoots: ["Sources", "资料/论文"],
    wikiRoot: "Wiki",
    schemaRef: "Knowledge/schema.md",
    reviewMode: "multi_file",
  };
}

/** Creates a valid durable Manifest owned by the default test Bundle. */
function createManifest(
  sourcePath = "Sources/研究.md",
  generatedPagePath = "Wiki/研究.md"
): SourceManifest {
  return {
    version: 1,
    bundleId: "personal",
    revision: 1,
    entries: [
      {
        sourceId: "source-1",
        sourcePath,
        sourceKey: toWindowsPathKey(sourcePath),
        custody: "user_managed",
        lastSuccessful: {
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          generatedPages: [{ path: generatedPagePath, ownership: "generated" }],
          changeSetId: "changeset-1",
          completedAt: 100,
        },
      },
    ],
  };
}

/** Creates a valid quote locator whose excerpt hash is internally consistent. */
function createLocator(excerpt = "支持这一结论的证据"): SourceLocator {
  return {
    kind: "quote",
    sourceId: "source-1",
    artifactId: "artifact-1",
    artifactContentHash: HASH_A,
    excerpt,
    quoteHash: createQuoteHash(excerpt),
  };
}

/** Creates a valid citation for ChangeSet and OKF validation. */
function createCitation(excerpt?: string): ClaimCitation {
  return {
    citationId: "citation-1",
    claimId: "claim-1",
    relation: "supports",
    locator: createLocator(excerpt),
  };
}

/** Creates a valid proposed create operation. */
function createFileChange(path = "Wiki/主题.md"): KnowledgeFileChange {
  const afterContent = "# 主题\n\n正文\n";
  return {
    id: "change-1",
    operation: "create",
    path,
    sourceRefs: ["source-1"],
    reason: "Create the generated concept page",
    expectedAbsent: true,
    afterContent,
    afterHash: createFileContentHash(afterContent),
  };
}

/** Creates a valid user-reviewable ChangeSet. */
function createChangeSet(path?: string): KnowledgeChangeSet {
  return {
    id: "changeset-1",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes: [createFileChange(path)],
    citations: [createCitation()],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 100,
  };
}

/** Extracts stable diagnostic codes for focused semantic assertions. */
function diagnosticCodes(result: { diagnostics: { code: string }[] }): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("validateVaultRelativePath", () => {
  it("accepts Unicode Vault-relative paths", () => {
    expect(validateVaultRelativePath("资料/论文/研究笔记.md")).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it.each([
    ["C:\\Users\\我\\资料\\报告.md", "path_absolute"],
    ["D:/知识库/论文.pdf", "path_absolute"],
    ["\\\\server\\share\\知识.pdf", "path_absolute"],
    ["Sources/../Wiki/page.md", "path_traversal"],
    ["Wiki/CON.md", "path_windows_reserved_name"],
    ["Wiki/aux.txt", "path_windows_reserved_name"],
    ["Wiki/COM1.json", "path_windows_reserved_name"],
    ["Wiki/name.", "path_windows_trailing_character"],
    ["Wiki/name ", "path_windows_trailing_character"],
    ["Wiki/na:me.md", "path_invalid_windows_character"],
  ])("rejects unsafe Windows path %j", (path, code) => {
    expect(diagnosticCodes(validateVaultRelativePath(path))).toContain(code);
  });
});

describe("validateKnowledgeBundleConfig", () => {
  it("accepts a valid Bundle with disjoint source, schema, and Wiki paths", () => {
    expect(validateKnowledgeBundleConfig(createBundle()).valid).toBe(true);
  });

  it("rejects case-insensitive duplicate source roots", () => {
    const bundle = createBundle();
    bundle.sourceRoots = ["Sources", "sources"];

    expect(diagnosticCodes(validateKnowledgeBundleConfig(bundle))).toContain(
      "source_root_duplicate"
    );
  });

  it("rejects overlapping raw sources and generated Wiki paths", () => {
    const bundle = createBundle();
    bundle.sourceRoots = ["Knowledge"];
    bundle.wikiRoot = "knowledge/Wiki";

    expect(diagnosticCodes(validateKnowledgeBundleConfig(bundle))).toContain("source_wiki_overlap");
  });

  it("rejects a schema stored inside the generated write boundary", () => {
    const bundle = createBundle();
    bundle.schemaRef = "wiki/schema.md";

    expect(diagnosticCodes(validateKnowledgeBundleConfig(bundle))).toContain("schema_inside_wiki");
  });
});

describe("validateSourceManifest", () => {
  it("accepts stable source identity plus successful and failed observations", () => {
    const manifest: SourceManifest = {
      version: 1,
      bundleId: "personal",
      revision: 2,
      entries: [
        {
          sourceId: "source-1",
          sourcePath: "Sources/研究.md",
          sourceKey: toWindowsPathKey("Sources/研究.md"),
          custody: "user_managed",
          lastSuccessful: {
            sourceContentHash: HASH_A,
            pipelineFingerprint: HASH_B,
            generatedPages: [{ path: "Wiki/研究.md", ownership: "generated" }],
            changeSetId: "changeset-1",
            completedAt: 100,
          },
          lastFailure: {
            sourceContentHash: "c".repeat(64),
            pipelineFingerprint: HASH_B,
            failure: {
              code: "provider_timeout",
              message: "Timed out",
              retryable: true,
              occurredAt: 200,
            },
          },
        },
      ],
    };

    expect(validateSourceManifest(manifest).valid).toBe(true);
  });

  it("rejects source keys that do not represent sourcePath", () => {
    const manifest: SourceManifest = {
      version: 1,
      bundleId: "personal",
      revision: 0,
      entries: [
        {
          sourceId: "source-1",
          sourcePath: "Sources/Page.md",
          sourceKey: "sources/another.md",
          custody: "user_managed",
        },
      ],
    };

    expect(diagnosticCodes(validateSourceManifest(manifest))).toContain("source_key_mismatch");
  });

  it("rejects case-insensitive duplicate source identities", () => {
    const firstPath = "Sources/Page.md";
    const secondPath = "sources/page.md";
    const manifest: SourceManifest = {
      version: 1,
      bundleId: "personal",
      revision: 0,
      entries: [
        {
          sourceId: "source-1",
          sourcePath: firstPath,
          sourceKey: toWindowsPathKey(firstPath),
          custody: "user_managed",
        },
        {
          sourceId: "source-2",
          sourcePath: secondPath,
          sourceKey: toWindowsPathKey(secondPath),
          custody: "user_managed",
        },
      ],
    };

    expect(diagnosticCodes(validateSourceManifest(manifest))).toContain("source_key_duplicate");
  });
});

describe("validateSourceManifestForBundle", () => {
  it("accepts a valid Manifest whose sources and generated pages honor Bundle boundaries", () => {
    expect(validateSourceManifestForBundle(createManifest(), createBundle())).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("rejects a Manifest owned by another Bundle", () => {
    const manifest = createManifest();
    manifest.bundleId = "another-bundle";

    const result = validateSourceManifestForBundle(manifest, createBundle());

    expect(diagnosticCodes(result)).toContain("manifest_bundle_mismatch");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "manifest_bundle_mismatch",
          field: "manifest.bundleId",
        }),
      ])
    );
  });

  it("rejects a registered source outside every configured source root", () => {
    const result = validateSourceManifestForBundle(
      createManifest("Elsewhere/研究.md"),
      createBundle()
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "manifest_source_outside_roots",
          field: "manifest.entries[0].sourcePath",
        }),
      ])
    );
  });

  it("rejects a registered source inside the generated Wiki", () => {
    const result = validateSourceManifestForBundle(
      createManifest("wiki/Imported.md"),
      createBundle()
    );

    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining(["manifest_source_outside_roots", "manifest_source_inside_wiki"])
    );
  });

  it("rejects a registered source equal to the Bundle schema under Windows comparison", () => {
    const bundle = createBundle();
    bundle.schemaRef = "Sources/Schema.md";

    const result = validateSourceManifestForBundle(createManifest("sources/schema.md"), bundle);

    expect(diagnosticCodes(result)).toContain("manifest_source_is_schema");
  });

  it("rejects a generated page outside the owning Wiki", () => {
    const result = validateSourceManifestForBundle(
      createManifest("Sources/研究.md", "Elsewhere/研究.md"),
      createBundle()
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "manifest_page_outside_wiki",
          field: "manifest.entries[0].lastSuccessful.generatedPages[0].path",
        }),
      ])
    );
  });

  it("rejects a generated page equal to the Wiki root under Windows comparison", () => {
    const result = validateSourceManifestForBundle(
      createManifest("Sources/研究.md", "wiki"),
      createBundle()
    );

    expect(diagnosticCodes(result)).toContain("manifest_page_is_wiki_root");
  });

  it("rejects a generated page inside a raw source root", () => {
    const result = validateSourceManifestForBundle(
      createManifest("Sources/研究.md", "sources/Generated.md"),
      createBundle()
    );

    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining(["manifest_page_outside_wiki", "manifest_page_inside_sources"])
    );
  });

  it("prefixes strict schema diagnostics for both persisted inputs", () => {
    const manifest = { ...createManifest(), unexpected: true };
    const bundle = { ...createBundle(), unexpected: true };

    const result = validateSourceManifestForBundle(manifest, bundle);

    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "schema_unrecognized_keys", field: "manifest" }),
        expect.objectContaining({ code: "schema_unrecognized_keys", field: "bundle" }),
      ])
    );
  });

  it("preserves nested field paths beneath Manifest and Bundle prefixes", () => {
    const manifest = createManifest() as unknown as Record<string, unknown>;
    const bundle = createBundle() as unknown as Record<string, unknown>;
    const entries = manifest.entries as Array<Record<string, unknown>>;
    entries[0].custody = "untrusted";
    bundle.reviewMode = "automatic";

    const result = validateSourceManifestForBundle(manifest, bundle);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "schema_invalid_enum_value",
          field: "manifest.entries[0].custody",
        }),
        expect.objectContaining({
          code: "schema_invalid_enum_value",
          field: "bundle.reviewMode",
        }),
      ])
    );
  });
});

describe("validateSourceLocator and validateClaimCitation", () => {
  it("accepts 1-based inclusive Markdown line coordinates", () => {
    const locator: SourceLocator = {
      ...createLocator("第一行\r\n第二行"),
      kind: "markdown_lines",
      startLine: 2,
      endLine: 3,
      heading: "结论",
    };

    expect(validateSourceLocator(locator).valid).toBe(true);
  });

  it("rejects a locator whose excerpt hash drifted", () => {
    const locator = { ...createLocator(), excerpt: "内容已经变化" };

    expect(diagnosticCodes(validateSourceLocator(locator))).toContain("quote_hash_mismatch");
  });

  it("rejects reversed Markdown line ranges", () => {
    const locator = {
      ...createLocator(),
      kind: "markdown_lines",
      startLine: 4,
      endLine: 3,
    };

    expect(diagnosticCodes(validateSourceLocator(locator))).toContain("locator_line_order_invalid");
  });

  it("validates the locator nested inside a citation", () => {
    const citation = createCitation();
    citation.locator.quoteHash = HASH_B;

    expect(diagnosticCodes(validateClaimCitation(citation))).toContain("quote_hash_mismatch");
  });
});

describe("validateKnowledgeFileChange and validateKnowledgeChangeSet", () => {
  it("accepts create, update, and delete CAS contracts", () => {
    const create = createFileChange();
    const updatedContent = "# Updated\n";
    const update: KnowledgeFileChange = {
      id: "change-2",
      operation: "update",
      path: "Wiki/Existing.md",
      sourceRefs: ["source-1"],
      reason: "Refresh generated content",
      beforeHash: HASH_A,
      afterContent: updatedContent,
      afterHash: createFileContentHash(updatedContent),
    };
    const deletion: KnowledgeFileChange = {
      id: "change-3",
      operation: "delete",
      path: "Wiki/Obsolete.md",
      sourceRefs: ["source-1"],
      reason: "Remove an obsolete generated page",
      beforeHash: HASH_B,
    };

    expect(validateKnowledgeFileChange(create).valid).toBe(true);
    expect(validateKnowledgeFileChange(update).valid).toBe(true);
    expect(validateKnowledgeFileChange(deletion).valid).toBe(true);
  });

  it("rejects after-content corruption", () => {
    const change = { ...createFileChange(), afterHash: HASH_A };

    expect(diagnosticCodes(validateKnowledgeFileChange(change))).toContain("after_hash_mismatch");
  });

  it("accepts a valid ChangeSet inside the Bundle Wiki root", () => {
    expect(validateKnowledgeChangeSet(createChangeSet(), createBundle()).valid).toBe(true);
  });

  it("rejects case-insensitive target collisions as one all-or-nothing set", () => {
    const changeSet = createChangeSet("Wiki/Page.md");
    const second = createFileChange("wiki/page.md");
    second.id = "change-2";
    changeSet.changes.push(second);

    expect(diagnosticCodes(validateKnowledgeChangeSet(changeSet, createBundle()))).toContain(
      "change_path_duplicate"
    );
  });

  it("rejects ancestor and descendant targets in one all-or-nothing set", () => {
    const changeSet = createChangeSet("Wiki/Topic");
    const descendant = createFileChange("Wiki/Topic/Page.md");
    descendant.id = "change-2";
    changeSet.changes.push(descendant);

    expect(diagnosticCodes(validateKnowledgeChangeSet(changeSet, createBundle()))).toContain(
      "change_path_overlap"
    );
  });

  it("rejects a ChangeSet that belongs to another Bundle", () => {
    const changeSet = createChangeSet();
    changeSet.bundleId = "another-bundle";

    expect(diagnosticCodes(validateKnowledgeChangeSet(changeSet, createBundle()))).toContain(
      "changeset_bundle_mismatch"
    );
  });

  it("rejects targets outside the Wiki or inside raw sources", () => {
    const outside = createChangeSet("Elsewhere/Page.md");
    const rawSource = createChangeSet("Sources/Page.md");

    expect(diagnosticCodes(validateKnowledgeChangeSet(outside, createBundle()))).toContain(
      "change_path_outside_wiki"
    );
    expect(diagnosticCodes(validateKnowledgeChangeSet(rawSource, createBundle()))).toEqual(
      expect.arrayContaining(["change_path_outside_wiki", "change_path_inside_source"])
    );
  });

  it("rejects a file target equal to the Wiki root itself", () => {
    expect(
      diagnosticCodes(validateKnowledgeChangeSet(createChangeSet("Wiki"), createBundle()))
    ).toContain("change_path_equals_wiki_root");
  });

  it("rejects undeclared file and citation source references", () => {
    const changeSet = createChangeSet();
    changeSet.changes[0].sourceRefs = ["source-2"];
    changeSet.citations[0].locator.sourceId = "source-2";

    expect(diagnosticCodes(validateKnowledgeChangeSet(changeSet, createBundle()))).toEqual(
      expect.arrayContaining(["change_source_ref_unknown", "citation_source_ref_unknown"])
    );
  });
});

describe("validateKnowledgeIngestJob", () => {
  it("rejects timestamps that move backwards after schema validation", () => {
    const job = {
      id: "job-1",
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      attempt: 0,
      rerunRequested: false,
      createdAt: 200,
      updatedAt: 100,
      status: "pending",
      stage: "queued",
    };

    expect(diagnosticCodes(validateKnowledgeIngestJob(job))).toContain(
      "job_timestamp_order_invalid"
    );
  });

  it("rejects state-specific timestamps outside the durable job lifetime", () => {
    const base = {
      id: "job-1",
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      attempt: 1,
      rerunRequested: false,
      createdAt: 100,
      updatedAt: 200,
    };

    expect(
      diagnosticCodes(
        validateKnowledgeIngestJob({
          ...base,
          status: "processing",
          stage: "parsing",
          startedAt: 99,
        })
      )
    ).toContain("job_started_timestamp_invalid");
    expect(
      diagnosticCodes(
        validateKnowledgeIngestJob({
          ...base,
          status: "paused",
          stage: "generating",
          pausedAt: 201,
        })
      )
    ).toContain("job_paused_timestamp_invalid");
    expect(
      diagnosticCodes(
        validateKnowledgeIngestJob({
          ...base,
          status: "failed",
          stage: "analyzing",
          failure: {
            code: "provider_timeout",
            message: "Provider timed out",
            retryable: true,
            occurredAt: 201,
          },
        })
      )
    ).toContain("job_failure_timestamp_invalid");
    expect(
      diagnosticCodes(
        validateKnowledgeIngestJob({
          ...base,
          status: "completed",
          stage: "completed",
          changeSetId: "changeset-1",
          completedAt: 99,
        })
      )
    ).toContain("job_completed_timestamp_invalid");
    expect(
      diagnosticCodes(
        validateKnowledgeIngestJob({
          ...base,
          status: "cancelled",
          stage: "cancelled",
          cancelledAt: 201,
        })
      )
    ).toContain("job_cancelled_timestamp_invalid");
  });

  it("requires a claimed attempt for states that cannot precede execution", () => {
    const processing = {
      id: "job-1",
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 1,
      attempt: 0,
      rerunRequested: false,
      createdAt: 100,
      updatedAt: 100,
      status: "processing",
      stage: "parsing",
      startedAt: 100,
    };

    expect(diagnosticCodes(validateKnowledgeIngestJob(processing))).toContain(
      "job_attempt_invalid"
    );
  });
});

describe("validateOkfDocument", () => {
  it("accepts concept, root index, nested index, and log documents", () => {
    const concept = {
      kind: "concept",
      path: "topics/研究.md",
      body: "# 研究",
      type: "topic",
      extensions: { confidence: 0.9, nested: { reviewed: true } },
      citations: [createCitation()],
    };

    expect(validateOkfDocument(concept).valid).toBe(true);
    expect(
      validateOkfDocument({ kind: "index", path: "index.md", body: "# Wiki", okfVersion: "0.1" })
        .valid
    ).toBe(true);
    expect(
      validateOkfDocument({ kind: "index", path: "topics/index.md", body: "# Topics" }).valid
    ).toBe(true);
    expect(validateOkfDocument({ kind: "log", path: "topics/log.md", body: "- entry" }).valid).toBe(
      true
    );
  });

  it("rejects reserved concept paths case-insensitively", () => {
    const concept = {
      kind: "concept",
      path: "topics/INDEX.md",
      body: "# Wrong",
      type: "topic",
      extensions: {},
      citations: [],
    };

    expect(diagnosticCodes(validateOkfDocument(concept))).toContain("okf_reserved_path");
  });

  it("rejects an OKF version declaration below the Bundle root", () => {
    const nestedIndex = {
      kind: "index",
      path: "topics/index.md",
      body: "# Topics",
      okfVersion: "0.1",
    };

    expect(diagnosticCodes(validateOkfDocument(nestedIndex))).toContain("okf_version_invalid");
  });
});
