jest.mock("obsidian", () => {
  const path = jest.requireActual<typeof import("node:path")>("node:path");
  class TFile {
    constructor(public path: string) {}
  }
  class FileSystemAdapter {
    constructor(private root: string) {}
    getBasePath() {
      return this.root;
    }
    getFullPath(relative: string) {
      return path.join(this.root, relative);
    }
  }
  return { ...jest.requireActual<Record<string, unknown>>("obsidian"), TFile, FileSystemAdapter };
});

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { FileSystemAdapter, TFile, type App } from "obsidian";
import { KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY } from "@/knowledge/compiler/KnowledgeCompilerPromptEncoder";
import { KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import type { KnowledgeSetupRequest } from "@/knowledge/setup/KnowledgeSetupPort";
import {
  KnowledgeSetupService,
  type KnowledgeSetupServiceDependencies,
  type KnowledgeSetupServiceProjectRecord,
} from "@/knowledge/setup/KnowledgeSetupService";
import type { ResolvedChatBackendEntry } from "@/modelManagement";
import {
  COPILOT_PROJECT_ID,
  COPILOT_PROJECT_KNOWLEDGE_BUNDLE,
  COPILOT_PROJECT_MODEL_KEY,
} from "@/projects/constants";

const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/13";
const CONFIG_DIR = ".test-config";
const PROJECT_PATH = "copilot/projects/Reading/project.md";
const REQUEST: KnowledgeSetupRequest = {
  projectId: "reading-project",
  configuredModelId: "configured-pro",
  sourceRoot: "Sources/Reading",
  wikiRoot: "Wiki/Reading",
  schemaRef: "Knowledge/Reading/rules.md",
  rules: { kind: "create", content: "# Reading rules\nPreserve evidence.\n" },
};
const roots: string[] = [];
const entry: ResolvedChatBackendEntry = {
  state: "ok",
  configuredModelId: "configured-pro",
  configuredModel: {
    configuredModelId: "configured-pro",
    providerId: "deepseek-account",
    info: { id: "deepseek-v4-pro", displayName: "DeepSeek Pro" },
    configuredAt: 1,
  },
  provider: {
    providerId: "deepseek-account",
    providerType: "openai-compatible",
    displayName: "My DeepSeek",
    origin: { kind: "byok", catalogProviderId: "deepseek" },
    requiresApiKey: true,
    apiKeyKeychainId: "secret-key-pointer",
    baseUrl: "https://api.deepseek.com",
    addedAt: 1,
  },
};

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-setup-"));
  roots.push(root);
  const adapter = new (FileSystemAdapter as unknown as new (root: string) => FileSystemAdapter)(
    root
  );
  const file = new (TFile as unknown as new (path: string) => TFile)(PROJECT_PATH);
  const records: KnowledgeSetupServiceProjectRecord[] = [
    {
      project: {
        id: REQUEST.projectId,
        name: "Reading",
        projectModelKey: "previous-selection",
        modelConfigs: {},
      },
      filePath: PROJECT_PATH,
    },
  ];
  let entries: ResolvedChatBackendEntry[] = [entry];
  let active = true;
  let beforePatch: (() => void | Promise<void>) | undefined;
  const initialFrontmatter = {
    [COPILOT_PROJECT_ID]: REQUEST.projectId,
    [COPILOT_PROJECT_MODEL_KEY]: "previous-selection",
    custom: { preserve: true },
  };
  const projectBody = "# Existing project\nDo not rewrite this body.\n";
  const writeProject = (
    frontmatter: Record<string, unknown> = initialFrontmatter,
    body = projectBody
  ) =>
    fs.writeFile(
      path.join(root, PROJECT_PATH),
      `---\n${JSON.stringify(frontmatter)}\n---\n${body}`
    );
  const readProject = async () => {
    const raw = await fs.readFile(path.join(root, PROJECT_PATH), "utf8");
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)!;
    return { frontmatter: JSON.parse(match[1]) as Record<string, unknown>, body: match[2], raw };
  };
  await fs.mkdir(path.dirname(path.join(root, PROJECT_PATH)), { recursive: true });
  await writeProject();
  Object.assign(adapter, {
    stat: async (relative: string) => {
      try {
        const stat = await fs.stat(path.join(root, relative));
        return {
          type: stat.isDirectory() ? "folder" : "file",
          size: stat.size,
          ctime: 1,
          mtime: 1,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    readBinary: async (relative: string) => {
      const bytes = await fs.readFile(path.join(root, relative));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  });
  const processFrontMatter = jest.fn(
    async (target: TFile, update: (value: Record<string, unknown>) => void) => {
      await beforePatch?.();
      const current = await readProject();
      update(current.frontmatter);
      await fs.writeFile(
        path.join(root, target.path),
        `---\n${JSON.stringify(current.frontmatter)}\n---\n${current.body}`
      );
    }
  );
  const createFolder = jest.fn(async (relative: string) => {
    await fs.mkdir(path.join(root, relative));
  });
  const dependencies: KnowledgeSetupServiceDependencies = {
    app: {
      vault: {
        adapter,
        configDir: CONFIG_DIR,
        createFolder,
        getAbstractFileByPath: (relative: string) => (relative === file.path ? file : null),
      },
      fileManager: { processFrontMatter },
    } as unknown as App,
    getProjectRecords: () => records,
    modelManagement: {
      backendConfigRegistry: { resolveEnabled: () => entries },
      configuredModelRegistry: { list: () => entries.map((item) => item.configuredModel) },
      providerRegistry: { list: () => entries.map((item) => item.provider) },
    } as unknown as KnowledgeSetupServiceDependencies["modelManagement"],
    profileOptions: {
      compilerVersion: "knowledge-compiler-v2",
      compilerConfiguration: { protocolVersion: 1 },
      parsers: [{ id: "text", version: "1", pathSuffixes: [".md"], configuration: {} }],
      outputLanguage: "source-language",
      supportedProviders: ["deepseek"],
      promptContractIdentity: KNOWLEDGE_COMPILER_PROMPT_CONTRACT_IDENTITY,
      providerRouteIdentities: { deepseek: KNOWLEDGE_DEEPSEEK_PRIVATE_ROUTE_IDENTITY },
    },
    isCurrent: () => active,
    loadNodeRuntime: () => ({ fs, path, randomUUID }),
  };
  return {
    root,
    file,
    records,
    dependencies,
    service: new KnowledgeSetupService(dependencies),
    readProject,
    writeProject,
    createFolder,
    processFrontMatter,
    setActive: (value: boolean) => {
      active = value;
    },
    setEntries: (value: ResolvedChatBackendEntry[]) => {
      entries = value;
    },
    beforePatch: (callback: () => void | Promise<void>) => {
      beforePatch = callback;
    },
  };
}

describe("KnowledgeSetupService", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });
  describe("KnowledgeSetupService", () => {
    describe("getOptions()", () => {
      it(`offers exact supported configured models without credentials or filesystem writes (${ISSUE})`, async () => {
        const h = await fixture();
        expect(h.service.getOptions()).toEqual({
          availability: "available",
          projects: [{ id: REQUEST.projectId, name: "Reading" }],
          models: [{ configuredModelId: "configured-pro", label: "DeepSeek Pro · My DeepSeek" }],
        });
        expect(JSON.stringify(h.service.getOptions())).not.toContain("secret-key-pointer");
        expect(h.createFolder).not.toHaveBeenCalled();
        expect(h.processFrontMatter).not.toHaveBeenCalled();
      });
      it(`blocks another setup when any Project already owns even an invalid Bundle (${ISSUE})`, async () => {
        const h = await fixture();
        h.records[0].project.knowledgeBundle = null;
        expect(h.service.getOptions().availability).toBe("bundle_exists");
      });
      it(`keeps a Project with an explicitly undefined Bundle eligible for first setup (${ISSUE})`, async () => {
        const h = await fixture();
        h.records[0].project.knowledgeBundle = undefined;
        expect(h.service.getOptions().availability).toBe("available");
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).resolves.toMatchObject({ projectId: REQUEST.projectId });
      });
      it(`omits unsupported providers and returns unavailable after unload (${ISSUE})`, async () => {
        const h = await fixture();
        h.setEntries([
          {
            ...entry,
            provider: { ...entry.provider, origin: { kind: "byok", catalogProviderId: "openai" } },
          },
        ]);
        expect(h.service.getOptions().models).toEqual([]);
        h.setActive(false);
        expect(h.service.getOptions().availability).toBe("unavailable");
      });
    });
    describe("configure()", () => {
      it(`creates requested folders and rules, then changes only Project Bundle and exact model fields (${ISSUE})`, async () => {
        const h = await fixture();
        const before = await h.readProject();
        const result = await h.service.configure(REQUEST, new AbortController().signal);
        expect(result).toEqual({
          projectId: REQUEST.projectId,
          bundleId: expect.any(String) as unknown,
          sourceRoot: REQUEST.sourceRoot,
          wikiRoot: REQUEST.wikiRoot,
          schemaRef: REQUEST.schemaRef,
        });
        const after = await h.readProject();
        expect(after.body).toBe(before.body);
        expect(after.frontmatter.custom).toEqual({ preserve: true });
        expect(after.frontmatter[COPILOT_PROJECT_MODEL_KEY]).toBe("configured-pro");
        expect(after.frontmatter[COPILOT_PROJECT_KNOWLEDGE_BUNDLE]).toEqual({
          version: 1,
          id: result.bundleId,
          sourceRoots: [REQUEST.sourceRoot],
          wikiRoot: REQUEST.wikiRoot,
          schemaRef: REQUEST.schemaRef,
          reviewMode: "always",
        });
        expect(await fs.readFile(path.join(h.root, REQUEST.schemaRef), "utf8")).toBe(
          REQUEST.rules.kind === "create" ? REQUEST.rules.content : ""
        );
        expect((await fs.stat(path.join(h.root, REQUEST.wikiRoot))).isDirectory()).toBe(true);
        expect(await fs.readdir(path.join(h.root, REQUEST.sourceRoot))).toEqual([]);
      });
      it(`reuses an explicitly selected existing rules file without altering its bytes (${ISSUE})`, async () => {
        const h = await fixture();
        await fs.mkdir(path.dirname(path.join(h.root, REQUEST.schemaRef)), { recursive: true });
        await fs.writeFile(path.join(h.root, REQUEST.schemaRef), "User-authored rules\r\n");
        await h.service.configure(
          { ...REQUEST, rules: { kind: "reuse" } },
          new AbortController().signal
        );
        expect(await fs.readFile(path.join(h.root, REQUEST.schemaRef), "utf8")).toBe(
          "User-authored rules\r\n"
        );
      });
      it(`refuses an existing rules file in create mode before creating directories or changing the Project (${ISSUE})`, async () => {
        const h = await fixture();
        await fs.mkdir(path.dirname(path.join(h.root, REQUEST.schemaRef)), { recursive: true });
        await fs.writeFile(path.join(h.root, REQUEST.schemaRef), "Keep me");
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).rejects.toMatchObject({ code: "rules_conflict" });
        expect(h.createFolder).not.toHaveBeenCalled();
        expect(h.processFrontMatter).not.toHaveBeenCalled();
      });
      it.each([
        { ...REQUEST, wikiRoot: REQUEST.sourceRoot },
        { ...REQUEST, sourceRoot: "../outside" },
        { ...REQUEST, schemaRef: `${REQUEST.wikiRoot}/rules.md` },
        { ...REQUEST, schemaRef: PROJECT_PATH, rules: { kind: "reuse" as const } },
      ])(`rejects invalid or overlapping paths before writes (${ISSUE})`, async (request) => {
        const h = await fixture();
        await expect(
          h.service.configure(request, new AbortController().signal)
        ).rejects.toMatchObject({ code: "invalid_configuration" });
        expect(h.createFolder).not.toHaveBeenCalled();
      });
      it(`rejects absent models and an existing Bundle before filesystem mutations (${ISSUE})`, async () => {
        const h = await fixture();
        h.setEntries([]);
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).rejects.toMatchObject({ code: "model_unavailable" });
        h.setEntries([entry]);
        h.records[0].project.knowledgeBundle = {};
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).rejects.toMatchObject({ code: "bundle_exists" });
        expect(h.createFolder).not.toHaveBeenCalled();
      });
      it(`rejects pre-cancelled or unloaded requests without writing (${ISSUE})`, async () => {
        const h = await fixture();
        const abort = new AbortController();
        abort.abort();
        await expect(h.service.configure(REQUEST, abort.signal)).rejects.toMatchObject({
          code: "unavailable",
        });
        h.setActive(false);
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).rejects.toMatchObject({ code: "unavailable" });
        expect(h.createFolder).not.toHaveBeenCalled();
      });
      it(`does not overwrite a Bundle added after the form opened (${ISSUE})`, async () => {
        const h = await fixture();
        h.beforePatch(async () => {
          const current = await h.readProject();
          current.frontmatter[COPILOT_PROJECT_KNOWLEDGE_BUNDLE] = { existing: true };
          await h.writeProject(current.frontmatter);
        });
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).rejects.toMatchObject({ code: "bundle_exists" });
        expect((await h.readProject()).frontmatter[COPILOT_PROJECT_KNOWLEDGE_BUNDLE]).toEqual({
          existing: true,
        });
      });
      it(`revalidates model enablement immediately before the frontmatter commit (${ISSUE})`, async () => {
        const h = await fixture();
        h.beforePatch(() => h.setEntries([]));
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).rejects.toMatchObject({ code: "model_unavailable" });
        expect((await h.readProject()).frontmatter[COPILOT_PROJECT_MODEL_KEY]).toBe(
          "previous-selection"
        );
      });
      it(`rejects a source-directory symlink outside the Vault without creating external folders (${ISSUE})`, async () => {
        const h = await fixture();
        const external = await fs.mkdtemp(path.join(os.tmpdir(), "setup-outside-"));
        roots.push(external);
        await fs.symlink(external, path.join(h.root, "Sources"), "dir");
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).rejects.toMatchObject({ code: "unsafe_path" });
        expect(await fs.readdir(external)).toEqual([]);
        expect(h.processFrontMatter).not.toHaveBeenCalled();
      });
      it(`rejects differently cased source-folder spelling so saved setup remains usable by exact-path import (${ISSUE})`, async () => {
        const h = await fixture();
        const actualFolder = path.join(h.root, "Chapters");
        const requestedFolder = path.join(h.root, "chapters");
        await fs.mkdir(actualFolder);
        const originalStat = h.dependencies.app.vault.adapter.stat;
        jest
          .spyOn(h.dependencies.app.vault.adapter, "stat")
          .mockImplementation((relative) =>
            originalStat(relative === "chapters" ? "Chapters" : relative)
          );
        const runtime = h.dependencies.loadNodeRuntime!();
        h.dependencies.loadNodeRuntime = () => ({
          ...runtime,
          fs: {
            ...runtime.fs,
            realpath: (target) =>
              runtime.fs.realpath(target === requestedFolder ? actualFolder : target),
          },
        });
        await expect(
          h.service.configure({ ...REQUEST, sourceRoot: "chapters" }, new AbortController().signal)
        ).rejects.toMatchObject({ code: "unsafe_path" });
        expect(h.processFrontMatter).not.toHaveBeenCalled();
        expect(await fs.readdir(actualFolder)).toEqual([]);
      });
      it(`rejects a Project file resolving outside the Vault before any setup writes (${ISSUE})`, async () => {
        const h = await fixture();
        const outside = await fs.mkdtemp(path.join(os.tmpdir(), "setup-project-outside-"));
        roots.push(outside);
        const externalFile = path.join(outside, "project.md");
        const before = await h.readProject();
        await fs.writeFile(externalFile, before.raw);
        await fs.unlink(path.join(h.root, PROJECT_PATH));
        await fs.symlink(externalFile, path.join(h.root, PROJECT_PATH));
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).rejects.toMatchObject({ code: "unsafe_path" });
        expect(await fs.readFile(externalFile, "utf8")).toBe(before.raw);
        expect(h.createFolder).not.toHaveBeenCalled();
      });
      it(`does not race a second setup while the first submission is pending (${ISSUE})`, async () => {
        const h = await fixture();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        h.createFolder.mockImplementationOnce(async (relative) => {
          await gate;
          await fs.mkdir(path.join(h.root, relative));
        });
        const first = h.service.configure(REQUEST, new AbortController().signal);
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).rejects.toMatchObject({ code: "busy" });
        release();
        await expect(first).resolves.toMatchObject({ projectId: REQUEST.projectId });
      });
      it(`rejects a Project id or model field changed in the file without overwriting it (${ISSUE})`, async () => {
        const h = await fixture();
        h.beforePatch(async () => {
          const current = await h.readProject();
          current.frontmatter[COPILOT_PROJECT_MODEL_KEY] = "someone-elses-selection";
          await h.writeProject(current.frontmatter);
        });
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).rejects.toMatchObject({ code: "project_changed" });
        expect((await h.readProject()).frontmatter[COPILOT_PROJECT_MODEL_KEY]).toBe(
          "someone-elses-selection"
        );
      });
      it.each(["", " ", "x".repeat(1_000_001)])(
        `rejects empty or oversized rules text before writes (${ISSUE})`,
        async (content) => {
          const h = await fixture();
          await expect(
            h.service.configure(
              { ...REQUEST, rules: { kind: "create", content } },
              new AbortController().signal
            )
          ).rejects.toMatchObject({ code: "rules_invalid" });
          expect(h.createFolder).not.toHaveBeenCalled();
        }
      );
      it(`rejects oversized existing rules before reading their content (${ISSUE})`, async () => {
        const h = await fixture();
        await fs.mkdir(path.dirname(path.join(h.root, REQUEST.schemaRef)), { recursive: true });
        await fs.writeFile(path.join(h.root, REQUEST.schemaRef), "x".repeat(1_000_001));
        const read = jest.spyOn(h.dependencies.app.vault.adapter, "readBinary");
        await expect(
          h.service.configure(
            { ...REQUEST, rules: { kind: "reuse" } },
            new AbortController().signal
          )
        ).rejects.toMatchObject({ code: "rules_invalid" });
        expect(read).not.toHaveBeenCalled();
        expect(h.createFolder).not.toHaveBeenCalled();
      });
      it(`rejects non-UTF-8 existing rules without changing the Project (${ISSUE})`, async () => {
        const h = await fixture();
        await fs.mkdir(path.dirname(path.join(h.root, REQUEST.schemaRef)), { recursive: true });
        await fs.writeFile(path.join(h.root, REQUEST.schemaRef), new Uint8Array([0xff, 0xfe]));
        await expect(
          h.service.configure(
            { ...REQUEST, rules: { kind: "reuse" } },
            new AbortController().signal
          )
        ).rejects.toMatchObject({ code: "rules_invalid" });
        expect(h.processFrontMatter).not.toHaveBeenCalled();
      });
      it(`preserves partial setup artifacts and sanitizes filesystem errors so an explicit reuse can retry (${ISSUE})`, async () => {
        const h = await fixture();
        h.processFrontMatter.mockRejectedValueOnce(new Error("private path / secret material"));
        await expect(
          h.service.configure(REQUEST, new AbortController().signal)
        ).rejects.toMatchObject({
          code: "write_failed",
          message: expect.not.stringContaining("secret material") as unknown,
        });
        expect(await fs.readFile(path.join(h.root, REQUEST.schemaRef), "utf8")).toContain(
          "Reading rules"
        );
        expect(
          (await h.readProject()).frontmatter[COPILOT_PROJECT_KNOWLEDGE_BUNDLE]
        ).toBeUndefined();
        await expect(
          h.service.configure(
            { ...REQUEST, rules: { kind: "reuse" } },
            new AbortController().signal
          )
        ).resolves.toMatchObject({ projectId: REQUEST.projectId });
      });
      it(`uses a fresh Bundle identity when setup is recreated so old sources cannot resume (${ISSUE})`, async () => {
        const h = await fixture();
        const first = await h.service.configure(REQUEST, new AbortController().signal);
        await h.writeProject();
        const second = await h.service.configure(
          { ...REQUEST, rules: { kind: "reuse" } },
          new AbortController().signal
        );
        expect(second.bundleId).not.toBe(first.bundleId);
      });
      it(`keeps existing materials and Wiki notes byte-identical instead of importing or rewriting them (${ISSUE})`, async () => {
        const h = await fixture();
        await fs.mkdir(path.join(h.root, REQUEST.sourceRoot), { recursive: true });
        await fs.mkdir(path.join(h.root, REQUEST.wikiRoot), { recursive: true });
        const source = path.join(h.root, REQUEST.sourceRoot, "chapter.md");
        const wiki = path.join(h.root, REQUEST.wikiRoot, "my-note.md");
        await fs.writeFile(source, "Original chapter\r\n");
        await fs.writeFile(wiki, "User-owned note\r\n");
        await h.service.configure(REQUEST, new AbortController().signal);
        expect(await fs.readFile(source, "utf8")).toBe("Original chapter\r\n");
        expect(await fs.readFile(wiki, "utf8")).toBe("User-owned note\r\n");
        expect(await fs.readdir(path.join(h.root, REQUEST.sourceRoot))).toEqual(["chapter.md"]);
      });
      it(`does not commit after a local cancellation during directory creation (${ISSUE})`, async () => {
        const h = await fixture();
        const abort = new AbortController();
        h.createFolder.mockImplementationOnce(async (relative) => {
          await fs.mkdir(path.join(h.root, relative));
          abort.abort();
        });
        await expect(h.service.configure(REQUEST, abort.signal)).rejects.toMatchObject({
          code: "unavailable",
        });
        expect(h.processFrontMatter).not.toHaveBeenCalled();
        expect(
          (await h.readProject()).frontmatter[COPILOT_PROJECT_KNOWLEDGE_BUNDLE]
        ).toBeUndefined();
      });
      it.each([
        { ...REQUEST, sourceRoot: `${CONFIG_DIR}/materials` },
        { ...REQUEST, wikiRoot: `${CONFIG_DIR}/generated` },
        {
          ...REQUEST,
          schemaRef: `${CONFIG_DIR}/plugins/copilot/data.json`,
          rules: { kind: "reuse" as const },
        },
      ])(
        `rejects source, Wiki, and rules paths inside Obsidian configuration before filesystem access (${ISSUE})`,
        async (request) => {
          const h = await fixture();
          const stat = jest.spyOn(h.dependencies.app.vault.adapter, "stat");
          const read = jest.spyOn(h.dependencies.app.vault.adapter, "readBinary");
          await expect(
            h.service.configure(request, new AbortController().signal)
          ).rejects.toMatchObject({ code: "unsafe_path" });
          expect(stat).not.toHaveBeenCalled();
          expect(read).not.toHaveBeenCalled();
          expect(h.createFolder).not.toHaveBeenCalled();
          expect(h.processFrontMatter).not.toHaveBeenCalled();
        }
      );
      it(`uses the actual custom configuration directory and rejects its ancestors (${ISSUE})`, async () => {
        const h = await fixture();
        Object.assign(h.dependencies.app.vault, { configDir: "Application/Private" });
        await expect(
          h.service.configure(
            { ...REQUEST, sourceRoot: "Application" },
            new AbortController().signal
          )
        ).rejects.toMatchObject({ code: "unsafe_path" });
        expect(h.createFolder).not.toHaveBeenCalled();
      });
      it(`rejects reused rules that change after initial inspection, including a byte-order-mark-only edit (${ISSUE})`, async () => {
        const h = await fixture();
        await fs.mkdir(path.dirname(path.join(h.root, REQUEST.schemaRef)), { recursive: true });
        await fs.writeFile(path.join(h.root, REQUEST.schemaRef), "Existing rules");
        h.createFolder.mockImplementationOnce(async (relative) => {
          await fs.mkdir(path.join(h.root, relative));
          await fs.writeFile(path.join(h.root, REQUEST.schemaRef), "\ufeffExisting rules");
        });
        await expect(
          h.service.configure(
            { ...REQUEST, rules: { kind: "reuse" } },
            new AbortController().signal
          )
        ).rejects.toMatchObject({ code: "rules_conflict" });
        expect(h.processFrontMatter).not.toHaveBeenCalled();
      });
    });
  });
});
