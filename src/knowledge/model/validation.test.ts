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
