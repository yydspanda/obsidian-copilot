import {
  ProjectKnowledgeBundleConfigSource,
  type ProjectKnowledgeBundleConfigInput,
} from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";

/**
 * Creates a valid Bundle with independent default boundaries.
 *
 * @param id - Stable Bundle identity
 * @param overrides - Fields to replace for one scenario
 * @returns Strict Bundle configuration
 */
function createBundle(
  id: string,
  overrides: Partial<KnowledgeBundleConfig> = {}
): KnowledgeBundleConfig {
  return {
    version: 1,
    id,
    sourceRoots: [`Sources/${id}`],
    wikiRoot: `Wiki/${id}`,
    schemaRef: `Schemas/${id}.md`,
    reviewMode: "always",
    ...overrides,
  };
}

describe("ProjectKnowledgeBundleConfigSource", () => {
  const source = new ProjectKnowledgeBundleConfigSource();

  it("distinguishes an absent configuration from an explicitly invalid value", () => {
    expect(source.load([{ id: "project-a" }, { id: "project-b" }])).toEqual({
      kind: "unconfigured",
    });

    expect(source.load([{ id: "project-a", knowledgeBundle: null }])).toEqual({
      kind: "invalid",
      diagnostics: [
        {
          code: "bundle_schema_invalid",
          projectIndex: 0,
          field: "knowledgeBundle",
        },
      ],
    });
  });

  it("strictly parses configured Bundles and retains exact path spelling in stable Bundle order", () => {
    const result = source.load([
      {
        id: "project-z",
        knowledgeBundle: createBundle("z", {
          sourceRoots: ["Sources/Zed"],
          wikiRoot: "Knowledge/Zed",
        }),
      },
      {
        id: "project-a",
        knowledgeBundle: createBundle("a", {
          sourceRoots: ["Sources/Alpha"],
          wikiRoot: "Knowledge/Alpha",
        }),
      },
    ]);

    expect(result).toEqual({
      kind: "configured",
      bundles: [
        {
          projectId: "project-a",
          config: createBundle("a", {
            sourceRoots: ["Sources/Alpha"],
            wikiRoot: "Knowledge/Alpha",
          }),
        },
        {
          projectId: "project-z",
          config: createBundle("z", {
            sourceRoots: ["Sources/Zed"],
            wikiRoot: "Knowledge/Zed",
          }),
        },
      ],
    });
  });

  it("fails closed on strict-schema errors and native paths without coercion or repair", () => {
    const strictShapeFailure = {
      ...createBundle("strict"),
      extra: true,
    };
    const nativePathFailure = createBundle("native", {
      wikiRoot: "Wiki\\Native",
    });

    const result = source.load([
      { id: "project-strict", knowledgeBundle: strictShapeFailure },
      { id: "project-native", knowledgeBundle: nativePathFailure },
    ]);

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") throw new Error("Expected invalid configuration");
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "bundle_semantic_invalid",
      "bundle_schema_invalid",
    ]);
    expect(result.diagnostics.every((diagnostic) => !("message" in diagnostic))).toBe(true);
  });

  it("rejects same-Bundle Wiki/source overlap and a schema inside its Wiki", () => {
    const result = source.load([
      {
        id: "project",
        knowledgeBundle: createBundle("bundle", {
          sourceRoots: ["Wiki/Bundle/Sources"],
          wikiRoot: "wiki/bundle",
          schemaRef: "WIKI/BUNDLE/schema.md",
        }),
      },
    ]);

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") throw new Error("Expected invalid configuration");
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "schema_inside_wiki",
      "wiki_source_overlap",
    ]);
  });

  it("rejects duplicate Bundle identities across projects", () => {
    const result = source.load([
      { id: "project-b", knowledgeBundle: createBundle("shared") },
      {
        id: "project-a",
        knowledgeBundle: createBundle("shared", {
          sourceRoots: ["Other/Sources"],
          wikiRoot: "Other/Wiki",
          schemaRef: "Other/Schema.md",
        }),
      },
    ]);

    expect(result).toEqual({
      kind: "invalid",
      diagnostics: [
        {
          code: "bundle_id_duplicate",
          projectIndex: 0,
          field: "knowledgeBundle.id",
        },
        {
          code: "bundle_id_duplicate",
          projectIndex: 1,
          field: "knowledgeBundle.id",
        },
      ],
    });
  });

  it("rejects case-insensitive ancestor overlap between different Wiki roots", () => {
    const result = source.load([
      {
        id: "project-a",
        knowledgeBundle: createBundle("a", { wikiRoot: "Knowledge" }),
      },
      {
        id: "project-b",
        knowledgeBundle: createBundle("b", { wikiRoot: "knowledge/Deep" }),
      },
    ]);

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") throw new Error("Expected invalid configuration");
    expect(result.diagnostics).toContainEqual({
      code: "wiki_root_overlap",
      projectIndex: 0,
      field: "knowledgeBundle.wikiRoot",
      relatedProjectIndex: 1,
    });
  });

  it("rejects any cross-Bundle Wiki/source overlap", () => {
    const result = source.load([
      {
        id: "project-a",
        knowledgeBundle: createBundle("a", { wikiRoot: "Knowledge/A" }),
      },
      {
        id: "project-b",
        knowledgeBundle: createBundle("b", {
          sourceRoots: ["knowledge/a/Imported"],
          wikiRoot: "Knowledge/B",
        }),
      },
    ]);

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") throw new Error("Expected invalid configuration");
    expect(result.diagnostics).toContainEqual({
      code: "wiki_source_overlap",
      projectIndex: 0,
      field: "knowledgeBundle.wikiRoot",
      relatedProjectIndex: 1,
    });
  });

  it("rejects a Bundle schema located inside any other Bundle Wiki", () => {
    const result = source.load([
      {
        id: "project-a",
        knowledgeBundle: createBundle("a", { wikiRoot: "Wiki/A" }),
      },
      {
        id: "project-b",
        knowledgeBundle: createBundle("b", { schemaRef: "wiki/a/Schema.md" }),
      },
    ]);

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") throw new Error("Expected invalid configuration");
    expect(result.diagnostics).toContainEqual({
      code: "schema_inside_wiki",
      projectIndex: 1,
      field: "knowledgeBundle.schemaRef",
      relatedProjectIndex: 0,
    });
  });

  it("never exposes untrusted project or Bundle identities in invalid diagnostics", () => {
    const untrustedProjectId = "<project-secret>";
    const untrustedBundleId = "<bundle-secret>";
    const result = source.load([
      {
        id: untrustedProjectId,
        knowledgeBundle: createBundle(untrustedBundleId, {
          sourceRoots: ["Wiki/Private/Source"],
          wikiRoot: "Wiki/Private",
        }),
      },
    ]);

    expect(result.kind).toBe("invalid");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(untrustedProjectId);
    expect(serialized).not.toContain(untrustedBundleId);
    expect(serialized).toContain('"projectIndex":0');
  });

  it("orders diagnostics identically when project input order changes", () => {
    const projects: ProjectKnowledgeBundleConfigInput[] = [
      {
        id: "project-z",
        knowledgeBundle: createBundle("z", { wikiRoot: "Shared/Wiki" }),
      },
      {
        id: "project-a",
        knowledgeBundle: createBundle("a", { wikiRoot: "shared/wiki/Child" }),
      },
      {
        id: "project-invalid",
        knowledgeBundle: { version: 1 },
      },
    ];

    const forward = source.load(projects);
    const reversed = source.load([...projects].reverse());

    expect(forward).toEqual(reversed);
    expect(forward.kind).toBe("invalid");
  });
});
