import { KnowledgeSetupNavigation } from "@/knowledge/setup/KnowledgeSetupNavigation";

const VALID_BUNDLE = Object.freeze({
  version: 1,
  id: "personal",
  sourceRoots: Object.freeze(["Sources/Personal"]),
  wikiRoot: "Wiki/Personal",
  schemaRef: "Schemas/personal.md",
  reviewMode: "always",
});

/** Creates an inert navigation dependency harness with inspectable effects. */
function createHarness() {
  const records: Array<{
    project: { id: string; knowledgeBundle?: unknown };
    filePath: string;
  }> = [];
  const dependencies = {
    getProjectRecords: jest.fn(() => records),
    getCurrentProjectId: jest.fn<string | undefined, []>(() => undefined),
    openCopilotSettings: jest.fn(),
    openVaultFile: jest.fn(),
    openChat: jest.fn(),
    refreshDisplayedStatus: jest.fn(),
    notify: jest.fn(),
  };
  return { records, dependencies, navigation: new KnowledgeSetupNavigation(dependencies) };
}

describe("KnowledgeSetupNavigation", () => {
  it("delegates only the existing settings, Chat, and local recheck actions", () => {
    const { dependencies, navigation } = createHarness();

    void navigation.openCopilotSettings();
    void navigation.openChat();
    void navigation.refreshDisplayedStatus();

    expect(dependencies.openCopilotSettings).toHaveBeenCalledTimes(1);
    expect(dependencies.openChat).toHaveBeenCalledTimes(1);
    expect(dependencies.refreshDisplayedStatus).toHaveBeenCalledTimes(1);
    expect(dependencies.openVaultFile).not.toHaveBeenCalled();
  });

  it("re-resolves and opens the only current configured Project file", () => {
    const { records, dependencies, navigation } = createHarness();
    records.push({
      project: { id: "personal", knowledgeBundle: VALID_BUNDLE },
      filePath: "copilot/projects/personal/project.md",
    });

    void navigation.openProjectFile();

    expect(dependencies.openVaultFile).toHaveBeenCalledWith("copilot/projects/personal/project.md");
    expect(dependencies.notify).not.toHaveBeenCalled();
  });

  it("opens a sole unconfigured Project but refuses an ambiguous Project identity", () => {
    const { records, dependencies, navigation } = createHarness();
    records.push({ project: { id: "one" }, filePath: "Projects/one/project.md" });
    void navigation.openProjectFile();
    expect(dependencies.openVaultFile).toHaveBeenCalledWith("Projects/one/project.md");

    records.push({ project: { id: "two" }, filePath: "Projects/two/project.md" });
    void navigation.openProjectFile();
    expect(dependencies.openVaultFile).toHaveBeenCalledTimes(1);
    expect(dependencies.notify).toHaveBeenCalledWith(expect.stringContaining("single current"));
  });

  it("opens the current exact Project when several unconfigured records exist", () => {
    const { records, dependencies, navigation } = createHarness();
    records.push(
      { project: { id: "one" }, filePath: "Projects/one/project.md" },
      { project: { id: "two" }, filePath: "Projects/two/project.md" }
    );
    dependencies.getCurrentProjectId.mockReturnValue("two");

    void navigation.openProjectFile();

    expect(dependencies.openVaultFile).toHaveBeenCalledWith("Projects/two/project.md");
    expect(dependencies.notify).not.toHaveBeenCalled();
  });

  it("does not include ambiguous private Project paths in its Notice", () => {
    const { records, dependencies, navigation } = createHarness();
    const privatePath = "Private/SECRET_API_KEY_CANARY/project.md";
    records.push(
      { project: { id: "one" }, filePath: privatePath },
      { project: { id: "two" }, filePath: "Private/other/project.md" }
    );

    void navigation.openProjectFile();

    expect(dependencies.openVaultFile).not.toHaveBeenCalled();
    expect(JSON.stringify(dependencies.notify.mock.calls)).not.toContain(privatePath);
    expect(JSON.stringify(dependencies.notify.mock.calls)).not.toContain("SECRET_API_KEY_CANARY");
  });

  it("opens only the single strictly configured rules file", () => {
    const { records, dependencies, navigation } = createHarness();
    records.push({
      project: { id: "personal", knowledgeBundle: VALID_BUNDLE },
      filePath: "Projects/personal/project.md",
    });

    void navigation.openSchema();

    expect(dependencies.openVaultFile).toHaveBeenCalledWith("Schemas/personal.md");
    expect(dependencies.notify).not.toHaveBeenCalled();
  });

  it("does not guess a rules file from invalid, absent, or multiple Bundle state", () => {
    const { records, dependencies, navigation } = createHarness();
    records.push({
      project: { id: "personal", knowledgeBundle: { version: "invalid" } },
      filePath: "Projects/personal/project.md",
    });

    void navigation.openSchema();

    expect(dependencies.openVaultFile).not.toHaveBeenCalled();
    expect(dependencies.notify).toHaveBeenCalledWith(expect.stringContaining("rules file"));
  });
});
