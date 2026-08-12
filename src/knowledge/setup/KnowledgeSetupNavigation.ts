import type { ProjectConfig } from "@/aiParams";
import { ProjectKnowledgeBundleConfigSource } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import type { KnowledgeSetupNavigationPort } from "@/knowledge/setup/KnowledgeSetupNavigationPort";

/** Project record fields required for current-identity setup navigation. */
export interface KnowledgeSetupProjectRecord {
  project: Pick<ProjectConfig, "id" | "knowledgeBundle">;
  filePath: string;
}

/** Side-effect boundaries retained by the setup navigation adapter. */
export interface KnowledgeSetupNavigationDependencies {
  getProjectRecords(): readonly KnowledgeSetupProjectRecord[];
  getCurrentProjectId(): string | undefined;
  openCopilotSettings(): void | Promise<void>;
  openVaultFile(path: string): void | Promise<void>;
  openChat(): void | Promise<void>;
  refreshDisplayedStatus(): void | Promise<void>;
  notify(message: string): void;
}

const PROJECT_FILE_UNAVAILABLE_NOTICE =
  "A single current Project file could not be resolved. Open Chat and choose the Project to edit.";
const SCHEMA_FILE_UNAVAILABLE_NOTICE =
  "A single current Knowledge rules file could not be resolved. Check the Project Bundle first.";

/** Returns whether an object owns the advanced Bundle field, including an explicit invalid value. */
function ownsKnowledgeBundle(project: Pick<ProjectConfig, "id" | "knowledgeBundle">): boolean {
  return Object.prototype.hasOwnProperty.call(project, "knowledgeBundle") === true;
}

/**
 * Least-authority navigation adapter for the local Knowledge setup page.
 *
 * Every file action resolves current project records again at click time. The
 * adapter never creates or updates a Project, directory, rules file, setting,
 * credential, Runtime record, or model request.
 */
export class KnowledgeSetupNavigation implements KnowledgeSetupNavigationPort {
  /** Creates navigation over current, injected Obsidian edge operations. */
  constructor(private readonly dependencies: KnowledgeSetupNavigationDependencies) {}

  /** Opens the existing Copilot settings surface. */
  openCopilotSettings(): void | Promise<void> {
    return this.dependencies.openCopilotSettings();
  }

  /** Opens one current Project file only when its identity is unambiguous. */
  openProjectFile(): void | Promise<void> {
    const records = this.dependencies.getProjectRecords();
    const configured = records.filter(({ project }) => ownsKnowledgeBundle(project));
    const currentProjectId = this.dependencies.getCurrentProjectId();
    const current =
      typeof currentProjectId === "string"
        ? records.filter(({ project }) => project.id === currentProjectId)
        : [];
    const candidate =
      configured.length === 1
        ? configured[0]
        : records.length === 1
          ? records[0]
          : current.length === 1
            ? current[0]
            : undefined;
    if (!candidate || candidate.filePath.trim().length === 0) {
      this.dependencies.notify(PROJECT_FILE_UNAVAILABLE_NOTICE);
      return;
    }
    return this.dependencies.openVaultFile(candidate.filePath);
  }

  /** Opens the single strictly configured Bundle's rules file after current re-resolution. */
  openSchema(): void | Promise<void> {
    const records = this.dependencies.getProjectRecords();
    const result = new ProjectKnowledgeBundleConfigSource().load(
      records.map(({ project }) => ({
        id: project.id,
        knowledgeBundle: project.knowledgeBundle,
      }))
    );
    if (result.kind !== "configured" || result.bundles.length !== 1) {
      this.dependencies.notify(SCHEMA_FILE_UNAVAILABLE_NOTICE);
      return;
    }
    return this.dependencies.openVaultFile(result.bundles[0].config.schemaRef);
  }

  /** Opens ordinary Copilot Chat without changing its model or Project. */
  openChat(): void | Promise<void> {
    return this.dependencies.openChat();
  }

  /** Refreshes the displayed local projection without testing a provider connection. */
  refreshDisplayedStatus(): void | Promise<void> {
    return this.dependencies.refreshDisplayedStatus();
  }
}
