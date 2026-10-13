export interface KnowledgeSetupNavigationPort {
  openCopilotSettings(): void | Promise<void>;

  openProjectFile(): void | Promise<void>;

  openSchema(): void | Promise<void>;

  openChat(): void | Promise<void>;

  openProjects(): void | Promise<void>;

  refreshDisplayedStatus(): void | Promise<void>;
}
