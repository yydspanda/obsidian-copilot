/**
 * Least-authority navigation surface exposed to Knowledge setup UI.
 *
 * Implementations may reveal existing Obsidian surfaces or files, but this
 * capability never creates Projects, changes settings, writes credentials, or
 * contacts a model.
 */
export interface KnowledgeSetupNavigationPort {
  /** Opens the existing Copilot settings surface. */
  openCopilotSettings(): void | Promise<void>;
  /** Opens the one currently resolvable project file, or reports a safe notice. */
  openProjectFile(): void | Promise<void>;
  /** Opens the one currently resolvable Knowledge rules file, or reports a safe notice. */
  openSchema(): void | Promise<void>;
  /** Opens the ordinary Copilot Chat workspace. */
  openChat(): void | Promise<void>;
  /** Refreshes the displayed local projection without testing a model connection. */
  refreshDisplayedStatus(): void | Promise<void>;
}
