import type { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import type { ProjectConfig } from "@/aiParams";
import type { TFile, Vault } from "obsidian";

import { Docs4LLMParser, FileParserManager } from "@/tools/FileParserManager";

jest.mock("@/LLMProviders/brevilabsClient", () => ({
  BrevilabsClient: jest.fn(),
}));

jest.mock("@/cache/pdfCache", () => ({
  PDFCache: {
    getInstance: jest.fn(() => ({
      clear: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
    })),
  },
}));

jest.mock("@/cache/projectContextCache", () => ({
  ProjectContextCache: {
    getInstance: jest.fn(),
  },
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: jest.fn(),
}));

jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoCustomUrl: jest.fn(() => ""),
}));

jest.mock("@/plusUtils", () => ({
  isSelfHostModeValid: jest.fn(() => false),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    convertedDocOutputFolder: "",
    enableMiyo: false,
  })),
}));

jest.mock("@/utils/convertedDocOutput", () => ({
  saveConvertedDocOutput: jest.fn(async () => {}),
}));

jest.mock("@/utils/rateLimitUtils", () => ({
  extractRetryTime: jest.fn(() => "later"),
  isRateLimitError: jest.fn(() => false),
}));

jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  TFile: class MockTFile {},
}));

jest.mock("@/tools/CanvasLoader", () => ({
  CanvasLoader: jest.fn(),
}));

interface ContextCacheMock {
  getOrReuseFileContext: jest.Mock;
  setFileContext: jest.Mock;
}

/**
 * Build a context cache mock for parser ownership tests.
 *
 * @param cachedContent - Optional content returned for a cache lookup
 * @returns Context cache interaction mock
 */
function createContextCache(cachedContent: string | null = null): ContextCacheMock {
  return {
    getOrReuseFileContext: jest.fn(async () => cachedContent),
    setFileContext: jest.fn(async () => {}),
  };
}

/**
 * Build a minimal project configuration.
 *
 * @returns Project used by Docs4LLMParser
 */
function createProject(): ProjectConfig {
  return {
    contextSource: {
      exclusions: "",
      inclusions: "",
    },
    id: "project-a",
    name: "Project A",
  } as ProjectConfig;
}

describe("FileParserManager Vault ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes its explicit Vault to the project context cache", () => {
    const ownerVault = {} as Vault;
    const otherVault = {} as Vault;
    (window as unknown as { app: { vault: Vault } }).app = { vault: otherVault };
    const contextCache = createContextCache();
    const { ProjectContextCache } = jest.requireMock<{
      ProjectContextCache: { getInstance: jest.Mock };
    }>("@/cache/projectContextCache");
    ProjectContextCache.getInstance.mockReturnValue(contextCache);

    new FileParserManager({} as BrevilabsClient, ownerVault, true, createProject());

    expect(ProjectContextCache.getInstance).toHaveBeenCalledTimes(1);
    expect(ProjectContextCache.getInstance).toHaveBeenCalledWith(ownerVault);
  });

  it("keeps parsing on the cache captured from its owner Vault", async () => {
    const ownerVault = {} as Vault;
    const otherVault = {} as Vault;
    (window as unknown as { app: { vault: Vault } }).app = { vault: otherVault };
    const ownerCache = createContextCache("owner-vault-content");
    const { ProjectContextCache } = jest.requireMock<{
      ProjectContextCache: { getInstance: jest.Mock };
    }>("@/cache/projectContextCache");
    ProjectContextCache.getInstance.mockReturnValue(ownerCache);
    const parser = new Docs4LLMParser({} as BrevilabsClient, ownerVault, createProject());
    const { TFile: MockTFile } = jest.requireMock<{
      TFile: new () => TFile;
    }>("obsidian");
    const file = Object.assign(new MockTFile(), {
      basename: "document",
      extension: "docx",
      path: "documents/document.docx",
    });

    await expect(parser.parseFile(file, ownerVault)).resolves.toBe("owner-vault-content");
    expect(ProjectContextCache.getInstance).toHaveBeenCalledWith(ownerVault);
    expect(ownerCache.getOrReuseFileContext).toHaveBeenCalledWith(
      expect.objectContaining({ id: "project-a" }),
      file.path
    );
  });
});
