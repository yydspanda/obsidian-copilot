import { parseKnowledgeBundleConfig } from "@/knowledge/model/schemas";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import { validateKnowledgeBundleConfig } from "@/knowledge/model/validation";
import { isPathWithinRoot } from "@/knowledge/paths/vaultPath";

/** Minimal project data required to discover knowledge Bundle configuration. */
export interface ProjectKnowledgeBundleConfigInput {
  id: string;
  knowledgeBundle?: unknown;
}

/** A strictly validated Bundle associated with its owning project. */
export interface ConfiguredProjectKnowledgeBundle {
  projectId: string;
  config: KnowledgeBundleConfig;
}

/** Stable, non-secret diagnostic categories emitted by the project config source. */
export type ProjectKnowledgeBundleDiagnosticCode =
  | "project_id_invalid"
  | "bundle_schema_invalid"
  | "bundle_semantic_invalid"
  | "bundle_id_duplicate"
  | "wiki_root_overlap"
  | "wiki_source_overlap"
  | "schema_inside_wiki";

/** Closed field vocabulary that cannot contain untrusted path or identity text. */
export type ProjectKnowledgeBundleDiagnosticField =
  | "project.id"
  | "knowledgeBundle"
  | "knowledgeBundle.id"
  | "knowledgeBundle.sourceRoots"
  | "knowledgeBundle.wikiRoot"
  | "knowledgeBundle.schemaRef";

/** Sanitized configuration diagnostic safe to expose to startup and UI adapters. */
export interface ProjectKnowledgeBundleDiagnostic {
  code: ProjectKnowledgeBundleDiagnosticCode;
  /** Index in the source's deterministic project ordering, never the caller's input ordering. */
  projectIndex: number;
  field: ProjectKnowledgeBundleDiagnosticField;
  relatedProjectIndex?: number;
}

/** Fail-closed result of loading every configured project knowledge Bundle. */
export type ProjectKnowledgeBundleConfigResult =
  | { kind: "unconfigured" }
  | {
      kind: "invalid";
      diagnostics: readonly ProjectKnowledgeBundleDiagnostic[];
    }
  | {
      kind: "configured";
      bundles: readonly ConfiguredProjectKnowledgeBundle[];
    };

interface IndexedProjectKnowledgeBundleInput {
  project: ProjectKnowledgeBundleConfigInput;
  index: number;
}

interface ParsedProjectKnowledgeBundle extends ConfiguredProjectKnowledgeBundle {
  projectIndex: number;
}

/**
 * Compares strings by code unit so ordering does not depend on the host locale.
 *
 * @param left - First value
 * @param right - Second value
 * @returns Negative, zero, or positive comparison result
 */
function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Tests two already-validated Vault paths for equal or ancestor overlap.
 *
 * @param left - First Vault-relative path
 * @param right - Second Vault-relative path
 * @returns Whether either path contains the other under Windows comparison rules
 */
function pathsOverlap(left: string, right: string): boolean {
  return isPathWithinRoot(left, right) || isPathWithinRoot(right, left);
}

/**
 * Maps a per-Bundle validator code to the source's public diagnostic vocabulary.
 *
 * @param code - Existing knowledge-model validation code
 * @returns Sanitized project configuration diagnostic code
 */
function mapSemanticDiagnosticCode(code: string): ProjectKnowledgeBundleDiagnosticCode {
  if (code === "source_wiki_overlap") return "wiki_source_overlap";
  if (code === "schema_inside_wiki") return "schema_inside_wiki";
  return "bundle_semantic_invalid";
}

/**
 * Maps an existing validator field to a closed, non-secret field category.
 *
 * @param field - Existing semantic validator field
 * @returns Static diagnostic field category
 */
function mapSemanticDiagnosticField(field: string): ProjectKnowledgeBundleDiagnosticField {
  if (field === "wikiRoot" || field.startsWith("wikiRoot.")) {
    return "knowledgeBundle.wikiRoot";
  }
  if (field === "schemaRef" || field.startsWith("schemaRef.")) {
    return "knowledgeBundle.schemaRef";
  }
  if (field === "sourceRoots" || field.startsWith("sourceRoots[")) {
    return "knowledgeBundle.sourceRoots";
  }
  return "knowledgeBundle";
}

/**
 * Produces a stable identity used to remove duplicate diagnostics.
 *
 * @param diagnostic - Sanitized diagnostic
 * @returns Deterministic identity containing no untrusted messages or values
 */
function createDiagnosticKey(diagnostic: ProjectKnowledgeBundleDiagnostic): string {
  return [
    String(diagnostic.projectIndex),
    diagnostic.code,
    diagnostic.field,
    diagnostic.relatedProjectIndex === undefined ? "" : String(diagnostic.relatedProjectIndex),
  ].join("\u0000");
}

/**
 * Sorts and removes duplicate sanitized diagnostics.
 *
 * @param diagnostics - Diagnostics collected across all projects
 * @returns Deterministically ordered diagnostics
 */
function finalizeDiagnostics(
  diagnostics: readonly ProjectKnowledgeBundleDiagnostic[]
): ProjectKnowledgeBundleDiagnostic[] {
  const unique = new Map<string, ProjectKnowledgeBundleDiagnostic>();
  for (const diagnostic of diagnostics) {
    unique.set(createDiagnosticKey(diagnostic), diagnostic);
  }

  return [...unique.values()].sort((left, right) => {
    return (
      left.projectIndex - right.projectIndex ||
      compareText(left.code, right.code) ||
      compareText(left.field, right.field) ||
      (left.relatedProjectIndex ?? -1) - (right.relatedProjectIndex ?? -1)
    );
  });
}

/**
 * Loads strict knowledge Bundle configuration from plain project data.
 *
 * This source deliberately has no access to project or settings singletons. It
 * preserves configured path spelling, performs no repair, and returns no Bundle
 * values when any project or cross-Bundle boundary is invalid.
 */
export class ProjectKnowledgeBundleConfigSource {
  /**
   * Parses and validates all configured project Bundles as one Windows write-boundary set.
   *
   * @param projects - Plain project records or ProjectConfig-compatible values
   * @returns Unconfigured, invalid, or fully configured aggregate state
   */
  public load(
    projects: readonly ProjectKnowledgeBundleConfigInput[]
  ): ProjectKnowledgeBundleConfigResult {
    const configuredInputs: IndexedProjectKnowledgeBundleInput[] = projects
      .map((project, index) => ({ project, index }))
      .filter(({ project }) => project.knowledgeBundle !== undefined);

    if (configuredInputs.length === 0) {
      return { kind: "unconfigured" };
    }

    configuredInputs.sort((left, right) => {
      const leftId = typeof left.project.id === "string" ? left.project.id : "";
      const rightId = typeof right.project.id === "string" ? right.project.id : "";
      return compareText(leftId, rightId) || left.index - right.index;
    });

    const diagnostics: ProjectKnowledgeBundleDiagnostic[] = [];
    const parsedBundles: ParsedProjectKnowledgeBundle[] = [];

    for (let projectIndex = 0; projectIndex < configuredInputs.length; projectIndex += 1) {
      const { project } = configuredInputs[projectIndex];
      const projectId = typeof project.id === "string" ? project.id : "";
      if (!projectId.trim()) {
        diagnostics.push({
          code: "project_id_invalid",
          projectIndex,
          field: "project.id",
        });
        continue;
      }

      const parsed = parseKnowledgeBundleConfig(project.knowledgeBundle);
      if (!parsed.ok) {
        diagnostics.push({
          code: "bundle_schema_invalid",
          projectIndex,
          field: "knowledgeBundle",
        });
        continue;
      }

      const validation = validateKnowledgeBundleConfig(parsed.value);
      for (const diagnostic of validation.diagnostics) {
        diagnostics.push({
          code: mapSemanticDiagnosticCode(diagnostic.code),
          projectIndex,
          field: mapSemanticDiagnosticField(diagnostic.field),
        });
      }

      parsedBundles.push({ projectId, config: parsed.value, projectIndex });
    }

    parsedBundles.sort((left, right) => {
      return (
        compareText(left.config.id, right.config.id) || compareText(left.projectId, right.projectId)
      );
    });

    this.validateDuplicateBundleIds(parsedBundles, diagnostics);
    this.validateCrossBundleBoundaries(parsedBundles, diagnostics);

    const finalizedDiagnostics = finalizeDiagnostics(diagnostics);
    if (finalizedDiagnostics.length > 0) {
      return { kind: "invalid", diagnostics: finalizedDiagnostics };
    }

    return {
      kind: "configured",
      bundles: parsedBundles.map(({ projectId, config }) => ({ projectId, config })),
    };
  }

  /**
   * Rejects Bundle identities assigned by more than one project.
   *
   * @param bundles - Strictly parsed project Bundles in stable order
   * @param diagnostics - Aggregate diagnostics to append
   */
  private validateDuplicateBundleIds(
    bundles: readonly ParsedProjectKnowledgeBundle[],
    diagnostics: ProjectKnowledgeBundleDiagnostic[]
  ): void {
    const ownersByBundleId = new Map<string, ParsedProjectKnowledgeBundle[]>();
    for (const bundle of bundles) {
      const owners = ownersByBundleId.get(bundle.config.id);
      if (owners) {
        owners.push(bundle);
      } else {
        ownersByBundleId.set(bundle.config.id, [bundle]);
      }
    }

    for (const owners of ownersByBundleId.values()) {
      if (owners.length < 2) continue;
      for (const owner of owners) {
        diagnostics.push({
          code: "bundle_id_duplicate",
          projectIndex: owner.projectIndex,
          field: "knowledgeBundle.id",
        });
      }
    }
  }

  /**
   * Rejects cross-Bundle Wiki, source, and schema boundary conflicts.
   *
   * @param bundles - Strictly parsed project Bundles in stable order
   * @param diagnostics - Aggregate diagnostics to append
   */
  private validateCrossBundleBoundaries(
    bundles: readonly ParsedProjectKnowledgeBundle[],
    diagnostics: ProjectKnowledgeBundleDiagnostic[]
  ): void {
    for (let leftIndex = 0; leftIndex < bundles.length; leftIndex += 1) {
      const left = bundles[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < bundles.length; rightIndex += 1) {
        const right = bundles[rightIndex];
        if (pathsOverlap(left.config.wikiRoot, right.config.wikiRoot)) {
          diagnostics.push({
            code: "wiki_root_overlap",
            projectIndex: left.projectIndex,
            field: "knowledgeBundle.wikiRoot",
            relatedProjectIndex: right.projectIndex,
          });
        }
      }
    }

    for (const wikiOwner of bundles) {
      for (const sourceOwner of bundles) {
        if (wikiOwner === sourceOwner) continue;
        for (let index = 0; index < sourceOwner.config.sourceRoots.length; index += 1) {
          if (!pathsOverlap(wikiOwner.config.wikiRoot, sourceOwner.config.sourceRoots[index])) {
            continue;
          }
          diagnostics.push({
            code: "wiki_source_overlap",
            projectIndex: wikiOwner.projectIndex,
            field: "knowledgeBundle.wikiRoot",
            relatedProjectIndex: sourceOwner.projectIndex,
          });
        }
      }
    }

    for (const schemaOwner of bundles) {
      for (const wikiOwner of bundles) {
        if (schemaOwner === wikiOwner) continue;
        if (!isPathWithinRoot(schemaOwner.config.schemaRef, wikiOwner.config.wikiRoot)) {
          continue;
        }
        diagnostics.push({
          code: "schema_inside_wiki",
          projectIndex: schemaOwner.projectIndex,
          field: "knowledgeBundle.schemaRef",
          relatedProjectIndex: wikiOwner.projectIndex,
        });
      }
    }
  }
}
