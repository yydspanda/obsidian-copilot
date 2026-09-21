import type { ProjectConfig } from "@/aiParams";
import { createKnowledgeConfiguredModelProjection } from "@/knowledge/compiler/KnowledgeConfiguredModelBridge";
import { ProjectKnowledgeBundleConfigSource } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import type { ProjectKnowledgePipelineProfileSourceOptions } from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import { isPathWithinRoot, parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { WindowsExclusiveKnowledgeFileCreator } from "@/knowledge/runtime/ObsidianKnowledgeFileStore";
import {
  loadObsidianNodeRuntimeModules,
  type ObsidianNodeRuntimeLoader,
} from "@/knowledge/runtime/ObsidianNodeRuntime";
import {
  KnowledgeSetupError,
  type KnowledgeSetupModelOption,
  type KnowledgeSetupOptions,
  type KnowledgeSetupPort,
  type KnowledgeSetupReceipt,
  type KnowledgeSetupRequest,
} from "@/knowledge/setup/KnowledgeSetupPort";
import type { ModelManagementApi } from "@/modelManagement";
import {
  COPILOT_PROJECT_ID,
  COPILOT_PROJECT_KNOWLEDGE_BUNDLE,
  COPILOT_PROJECT_MODEL_KEY,
} from "@/projects/constants";
import { sha256, sha256Bytes } from "@/utils/hash";
import { FileSystemAdapter, TFile, type App } from "obsidian";

const EMPTY_PROJECTS = Object.freeze([]);
const EMPTY_MODELS = Object.freeze([]);
const UNAVAILABLE_OPTIONS: KnowledgeSetupOptions = Object.freeze({
  availability: "unavailable",
  projects: EMPTY_PROJECTS,
  models: EMPTY_MODELS,
});
const MAX_RULES_BYTES = 1_000_000;

/** Tests the presence of configuration, including explicit invalid or null values. */
function hasBundle(project: KnowledgeSetupServiceProjectRecord["project"]): boolean {
  return project.knowledgeBundle !== undefined;
}

function bundleFor(request: Readonly<KnowledgeSetupRequest>): KnowledgeBundleConfig {
  return {
    version: 1,
    id: `knowledge-${sha256(request.projectId).slice(0, 16)}`,
    sourceRoots: [request.sourceRoot],
    wikiRoot: request.wikiRoot,
    schemaRef: request.schemaRef,
    reviewMode: "always",
  };
}

/** Project identity retained by setup, without giving it the Project manager's write surface. */
export interface KnowledgeSetupServiceProjectRecord {
  project: Pick<
    ProjectConfig,
    "id" | "name" | "projectModelKey" | "modelConfigs" | "knowledgeBundle"
  >;
  filePath: string;
}

/** Current owners and local registries injected at the plugin boundary. */
export interface KnowledgeSetupServiceDependencies {
  app: App;
  getProjectRecords(): readonly KnowledgeSetupServiceProjectRecord[];
  modelManagement: Pick<
    ModelManagementApi,
    "backendConfigRegistry" | "configuredModelRegistry" | "providerRegistry"
  >;
  profileOptions: ProjectKnowledgePipelineProfileSourceOptions;
  isCurrent(): boolean;
  loadNodeRuntime?: ObsidianNodeRuntimeLoader;
}

/** Configures one existing Project without importing sources or making model requests. */
export class KnowledgeSetupService implements KnowledgeSetupPort {
  private configuring = false;

  /** @param dependencies Current Project/model owners and the exact Vault filesystem edge. */
  constructor(private readonly dependencies: KnowledgeSetupServiceDependencies) {}

  /** Returns local choices without reading credentials, importing files, or testing a provider. */
  getOptions(): KnowledgeSetupOptions {
    if (!this.dependencies.isCurrent()) return UNAVAILABLE_OPTIONS;
    const records = this.dependencies.getProjectRecords();
    const projects = records.map(({ project }) => ({ id: project.id, name: project.name }));
    const models: KnowledgeSetupModelOption[] = [];
    const probe = bundleFor(MODEL_PROBE_REQUEST);
    for (const entry of this.dependencies.modelManagement.backendConfigRegistry.resolveEnabled(
      "chat"
    )) {
      if (entry.state !== "ok") continue;
      // Only the existing Knowledge policy can decide whether a picker row is supported.
      // https://github.com/yydspanda/obsidian-copilot/issues/13
      try {
        this.modelIdentity(entry.configuredModelId, { id: "setup", modelConfigs: {} }, probe);
        models.push({
          configuredModelId: entry.configuredModelId,
          label: `${entry.configuredModel.info.displayName || entry.configuredModel.info.id} · ${entry.provider.displayName}`,
        });
      } catch (error) {
        if (!(error instanceof KnowledgeSetupError)) throw error;
      }
    }
    return {
      availability: records.some(({ project }) => hasBundle(project))
        ? "bundle_exists"
        : "available",
      projects: projects.length ? Object.freeze(projects) : EMPTY_PROJECTS,
      models: models.length ? Object.freeze(models) : EMPTY_MODELS,
    };
  }

  /**
   * Creates missing setup artifacts and attaches a Bundle to one unchanged Project.
   * Existing files are never replaced, and no source becomes registered by this operation.
   * @param input Explicit form choices captured for this submission.
   * @param signal Cancellation for this submission; published artifacts are not deleted on failure.
   */
  async configure(
    input: Readonly<KnowledgeSetupRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeSetupReceipt> {
    // A second popout must not race the first setup into a different Bundle.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    if (this.configuring) throw new KnowledgeSetupError("busy");
    this.configuring = true;
    try {
      return await this.configureOnce(input, signal);
    } catch (error) {
      if (error instanceof KnowledgeSetupError) throw error;
      throw new KnowledgeSetupError("write_failed");
    } finally {
      this.configuring = false;
    }
  }

  private assertCurrent(signal: AbortSignal): void {
    if (signal.aborted || !this.dependencies.isCurrent())
      throw new KnowledgeSetupError("unavailable");
  }

  private resolveProject(id: string): KnowledgeSetupServiceProjectRecord {
    const records = this.dependencies.getProjectRecords();
    // Even an invalid Bundle owns a user's setup decision; the wizard cannot repair or replace it.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    if (records.some(({ project }) => hasBundle(project)))
      throw new KnowledgeSetupError("bundle_exists");
    const matches = records.filter(({ project }) => project.id === id);
    if (matches.length !== 1) throw new KnowledgeSetupError("project_changed");
    return matches[0];
  }

  private modelIdentity(
    selection: string,
    project: Pick<ProjectConfig, "id" | "modelConfigs">,
    bundle: KnowledgeBundleConfig
  ): string {
    const modelManagement = this.dependencies.modelManagement;
    const enabledChatModels = modelManagement.backendConfigRegistry.resolveEnabled("chat");
    // Persist only exact configured ids, never a display name or an account-ambiguous legacy key.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    const selected = enabledChatModels.filter(
      (entry) => entry.state === "ok" && entry.configuredModelId === selection
    );
    if (selected.length !== 1 || selected[0].state !== "ok")
      throw new KnowledgeSetupError("model_unavailable");
    const projection = createKnowledgeConfiguredModelProjection({
      owners: [{ projectId: project.id, config: bundle }],
      projects: [{ id: project.id, modelSelection: selection, modelConfigs: project.modelConfigs }],
      enabledChatModels,
      configuredModels: modelManagement.configuredModelRegistry.list(),
      providers: modelManagement.providerRegistry.list(),
      profileOptions: this.dependencies.profileOptions,
    });
    if (projection.kind !== "ready") throw new KnowledgeSetupError("model_unavailable");
    return sha256(
      JSON.stringify({
        model: selected[0].configuredModel,
        provider: selected[0].provider,
        modelConfigs: project.modelConfigs,
      })
    );
  }

  private async configureOnce(
    input: Readonly<KnowledgeSetupRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeSetupReceipt> {
    this.assertCurrent(signal);
    const request: KnowledgeSetupRequest = { ...input, rules: { ...input.rules } };
    if (
      !request.projectId ||
      !request.configuredModelId ||
      ![request.sourceRoot, request.wikiRoot, request.schemaRef].every(
        (value) => parseVaultPath(value).ok
      )
    )
      throw new KnowledgeSetupError("invalid_configuration");
    const configDir = this.dependencies.app.vault.configDir;
    // Plugin settings and credentials cannot become rules, source material, or generated output.
    // Honor Obsidian's actual configuration directory, including custom locations.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    if (
      !parseVaultPath(configDir).ok ||
      [request.sourceRoot, request.wikiRoot, request.schemaRef].some(
        (destination) =>
          isPathWithinRoot(destination, configDir) || isPathWithinRoot(configDir, destination)
      )
    )
      throw new KnowledgeSetupError("unsafe_path");
    if (request.rules.kind !== "create" && request.rules.kind !== "reuse")
      throw new KnowledgeSetupError("rules_invalid");
    if (
      request.rules.kind === "create" &&
      (typeof request.rules.content !== "string" ||
        !request.rules.content.trim() ||
        new TextEncoder().encode(request.rules.content).byteLength > MAX_RULES_BYTES)
    )
      throw new KnowledgeSetupError("rules_invalid");
    const record = this.resolveProject(request.projectId);
    const projectPath = record.filePath;
    const originalModelSelection = record.project.projectModelKey;
    const bundle = bundleFor(request);
    const candidates = this.dependencies
      .getProjectRecords()
      .map(({ project }) =>
        project.id === request.projectId ? { ...project, knowledgeBundle: bundle } : project
      );
    const validation = new ProjectKnowledgeBundleConfigSource().load(candidates);
    if (
      validation.kind !== "configured" ||
      validation.bundles.length !== 1 ||
      isPathWithinRoot(projectPath, request.wikiRoot) ||
      toWindowsPathKey(projectPath) === toWindowsPathKey(request.schemaRef)
    )
      throw new KnowledgeSetupError("invalid_configuration");
    const modelIdentity = this.modelIdentity(request.configuredModelId, record.project, bundle);
    const app = this.dependencies.app;
    const adapter = app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new KnowledgeSetupError("unavailable");
    const loadRuntime = this.dependencies.loadNodeRuntime ?? loadObsidianNodeRuntimeModules;
    const runtime = loadRuntime();
    // Recreating setup must not reconnect an orphaned Runtime and restart its historical sources.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    bundle.id = `knowledge-${runtime.randomUUID()}`;
    const root = await runtime.fs.realpath(adapter.getBasePath());
    const assertPath = async (vaultPath: string): Promise<void> => {
      this.assertCurrent(signal);
      if ((await runtime.fs.realpath(adapter.getBasePath())) !== root)
        throw new KnowledgeSetupError("unsafe_path");
      const realPath = await runtime.fs.realpath(adapter.getFullPath(vaultPath));
      const relative = runtime.path.relative(root, realPath);
      // Aliases can defeat source/Wiki separation; exact spelling also keeps setup paths usable
      // by the importer's canonical-path checks on case-insensitive filesystems.
      // https://github.com/yydspanda/obsidian-copilot/issues/13
      if (
        runtime.path.isAbsolute(relative) ||
        relative === ".." ||
        relative.startsWith(`..${runtime.path.sep}`) ||
        relative.replace(/\\/g, "/") !== vaultPath
      )
        throw new KnowledgeSetupError("unsafe_path");
      this.assertCurrent(signal);
    };
    const projectFile = app.vault.getAbstractFileByPath(projectPath);
    if (!(projectFile instanceof TFile)) throw new KnowledgeSetupError("project_changed");
    await assertPath(projectPath);

    const readRules = async (): Promise<string> => {
      await assertPath(request.schemaRef);
      const stat = await adapter.stat(request.schemaRef);
      if (!stat || stat.type !== "file" || stat.size < 1 || stat.size > MAX_RULES_BYTES)
        throw new KnowledgeSetupError("rules_invalid");
      const bytes = await adapter.readBinary(request.schemaRef);
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_RULES_BYTES)
        throw new KnowledgeSetupError("rules_invalid");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new KnowledgeSetupError("rules_invalid");
      }
      if (!text.trim()) throw new KnowledgeSetupError("rules_invalid");
      await assertPath(request.schemaRef);
      return sha256Bytes(bytes);
    };
    const existingRules = await adapter.stat(request.schemaRef);
    if (request.rules.kind === "create" && existingRules)
      throw new KnowledgeSetupError("rules_conflict");
    if (request.rules.kind === "reuse" && !existingRules)
      throw new KnowledgeSetupError("rules_invalid");
    const rulesIdentity =
      request.rules.kind === "reuse" ? await readRules() : sha256(request.rules.content);

    const ensureDirectory = async (directory: string): Promise<void> => {
      let current = "";
      for (const segment of directory.split("/")) {
        this.assertCurrent(signal);
        if (current) await assertPath(current);
        current = current ? `${current}/${segment}` : segment;
        const stat = await adapter.stat(current);
        if (stat && stat.type !== "folder") throw new KnowledgeSetupError("unsafe_path");
        if (!stat) await app.vault.createFolder(current);
        await assertPath(current);
      }
    };
    await ensureDirectory(request.sourceRoot);
    await ensureDirectory(request.wikiRoot);
    const schemaParent = request.schemaRef.slice(0, request.schemaRef.lastIndexOf("/"));
    if (request.schemaRef.includes("/")) await ensureDirectory(schemaParent);
    this.assertCurrent(signal);
    if (request.rules.kind === "create") {
      const created = await new WindowsExclusiveKnowledgeFileCreator(adapter, loadRuntime).create(
        request.schemaRef,
        request.rules.content
      );
      if (created !== "created") throw new KnowledgeSetupError("rules_conflict");
    }
    if ((await readRules()) !== rulesIdentity) throw new KnowledgeSetupError("rules_conflict");
    await assertPath(request.sourceRoot);
    await assertPath(request.wikiRoot);
    await assertPath(projectPath);
    const revalidate = (): void => {
      this.assertCurrent(signal);
      const current = this.resolveProject(request.projectId);
      if (
        current.filePath !== projectPath ||
        current.project.projectModelKey !== originalModelSelection ||
        projectFile.path !== projectPath ||
        app.vault.getAbstractFileByPath(projectPath) !== projectFile
      )
        throw new KnowledgeSetupError("project_changed");
      if (this.modelIdentity(request.configuredModelId, current.project, bundle) !== modelIdentity)
        throw new KnowledgeSetupError("model_unavailable");
    };
    revalidate();
    await app.fileManager.processFrontMatter(
      projectFile,
      (frontmatter: Record<string, unknown>) => {
        revalidate();
        // Read the live fields inside Obsidian's patch callback so an intervening edit wins.
        // https://github.com/yydspanda/obsidian-copilot/issues/13
        if (frontmatter[COPILOT_PROJECT_KNOWLEDGE_BUNDLE] !== undefined)
          throw new KnowledgeSetupError("bundle_exists");
        if (
          frontmatter[COPILOT_PROJECT_ID] !== request.projectId ||
          (frontmatter[COPILOT_PROJECT_MODEL_KEY] ?? "") !== originalModelSelection
        )
          throw new KnowledgeSetupError("project_changed");
        frontmatter[COPILOT_PROJECT_KNOWLEDGE_BUNDLE] = bundle;
        frontmatter[COPILOT_PROJECT_MODEL_KEY] = request.configuredModelId;
      }
    );
    // The Project event can revoke this generation after the durable patch; success remains true.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    return {
      projectId: request.projectId,
      bundleId: bundle.id,
      sourceRoot: request.sourceRoot,
      wikiRoot: request.wikiRoot,
      schemaRef: request.schemaRef,
    };
  }
}

/** Inert paths used only to ask the model policy for local picker eligibility. */
const MODEL_PROBE_REQUEST: KnowledgeSetupRequest = Object.freeze({
  projectId: "setup",
  configuredModelId: "",
  sourceRoot: "Sources",
  wikiRoot: "Wiki",
  schemaRef: "Rules.md",
  rules: Object.freeze({ kind: "reuse" }),
});
