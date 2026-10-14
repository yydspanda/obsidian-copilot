import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { App, FileSystemAdapter, TFile } from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/utils/openWithSystemDefault", () => ({ openWithSystemDefault: jest.fn() }));
jest.mock("obsidian", () => ({
  FileSystemAdapter: class FileSystemAdapter {
    private readonly base: string;
    constructor(base = "/vault") {
      this.base = base;
    }
    getBasePath(): string {
      return this.base;
    }
  },
  Notice: jest.fn(),
  TFile: class TFile {},
  MarkdownRenderer: { render: jest.fn().mockResolvedValue(undefined) },
}));

const VAULT = "/Users/me/vault";

interface TestApp {
  workspace: { openLinkText: jest.Mock; getActiveFile: () => null };
  vault: { adapter: unknown; getAbstractFileByPath: jest.Mock };
}

function buildApp(base = VAULT, indexedFiles: string[] = []): TestApp {
  const adapter = new (FileSystemAdapter as unknown as new (b: string) => unknown)(base);
  return {
    workspace: { openLinkText: jest.fn(), getActiveFile: () => null },
    vault: {
      adapter,
      getAbstractFileByPath: jest.fn((path: string) =>
        indexedFiles.includes(path) ? new TFile() : null
      ),
    },
  };
}

async function renderLink(app: TestApp, href: string, external = false) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const register = jest.fn();
  await renderMarkdown(app as unknown as App, "irrelevant", el, "source.md", {
    register,
  } as unknown as Parameters<typeof renderMarkdown>[4]);
  const a = document.createElement("a");
  a.className = external ? "external-link" : "internal-link";
  a.setAttribute(external ? "href" : "data-href", href);
  el.appendChild(a);
  return {
    click(init: MouseEventInit = { button: 0 }): boolean {
      const type = init.button === 1 ? "auxclick" : "click";
      let handled = false;
      el.addEventListener(
        type,
        (event) => {
          handled = event.defaultPrevented;
          event.preventDefault();
        },
        { once: true }
      );
      a.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
      return handled;
    },
    dispose: () => {
      register.mock.calls[0][0]();
    },
  };
}

describe("renderMarkdown", () => {
  describe("renderMarkdown()", () => {
    beforeEach(() => {
      __resetVaultBaseCache();
      jest.clearAllMocks();
      document.body.innerHTML = "";
    });

    it("opens a clicked internal link with its absolute in-vault path converted to vault-relative", async () => {
      const app = buildApp();
      const link = await renderLink(app, "/Users/me/vault/00_Inbox/Foo.md");
      expect(link.click()).toBe(true);
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "00_Inbox/Foo.md",
        "source.md",
        false
      );
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });

    it("decodes a percent-encoded link target before opening it", async () => {
      const app = buildApp();
      const link = await renderLink(app, "/Users/me/vault/00_Inbox/Foo%20Bar.md");
      expect(link.click()).toBe(true);
      expect(app.workspace.openLinkText).toHaveBeenCalledWith(
        "00_Inbox/Foo Bar.md",
        "source.md",
        false
      );
    });

    it("opens the link in a new leaf on ctrl-click", async () => {
      const app = buildApp();
      const link = await renderLink(app, "/Users/me/vault/00_Inbox/Foo.md");
      expect(link.click({ button: 0, ctrlKey: true })).toBe(true);
      expect(app.workspace.openLinkText).toHaveBeenCalledWith("00_Inbox/Foo.md", "source.md", true);
    });

    it.each([
      ["C:/Reading Vault", "C:/Reading%20Vault/chapters/%E8%B0%83%E7%A0%94.md#%E6%9D%90%E6%96%99"],
      [
        "C:\\Reading Vault",
        "C:\\Reading%20Vault\\chapters\\%E8%B0%83%E7%A0%94.md#%E6%9D%90%E6%96%99",
      ],
      ["/Users/me/vault", "/Users/me/vault/chapters/%E8%B0%83%E7%A0%94.md#%E6%9D%90%E6%96%99"],
    ])(
      "opens an existing absolute source rendered as external under %s, preserving its decoded heading (https://github.com/yydspanda/obsidian-copilot/issues/25)",
      async (base, href) => {
        const app = buildApp(base, ["chapters/调研.md"]);
        const link = await renderLink(app, href, true);
        expect(link.click()).toBe(true);
        expect(app.workspace.openLinkText).toHaveBeenCalledWith(
          "chapters/调研.md#材料",
          "source.md",
          false
        );
        expect(openWithSystemDefault).not.toHaveBeenCalled();
      }
    );

    it.each([{ button: 0, ctrlKey: true }, { button: 0, metaKey: true }, { button: 1 }])(
      "opens an external-class Vault source in a new leaf for modifier %j (https://github.com/yydspanda/obsidian-copilot/issues/25)",
      async (init) => {
        const app = buildApp("C:/Vault", ["notes/Source.md"]);
        const link = await renderLink(app, "C:/Vault/notes/Source.md", true);
        expect(link.click(init)).toBe(true);
        expect(app.workspace.openLinkText).toHaveBeenCalledWith(
          "notes/Source.md",
          "source.md",
          true
        );
      }
    );

    it.each([
      "https://example.com/C:/Vault/notes/Source.md",
      "mailto:reader@example.com",
      "C:/Other/Source.md",
      "C:/Vault-copy/Source.md",
      "C:/Vault/../Other/Source.md",
      "C:/Vault/%2e%2e/Other/Source.md",
      "C:\\Vault\\..\\Other\\Source.md",
      "C:/Vault/notes/Missing.md",
      "C:/Vault",
      "file:///C:/Vault/notes/Source.md",
    ])(
      "leaves an external target outside the indexed Vault-file contract to Obsidian: %s (https://github.com/yydspanda/obsidian-copilot/issues/25)",
      async (href) => {
        const app = buildApp("C:/Vault", ["notes/Source.md", "../Other/Source.md"]);
        const link = await renderLink(app, href, true);
        expect(link.click()).toBe(false);
        expect(app.workspace.openLinkText).not.toHaveBeenCalled();
        expect(openWithSystemDefault).not.toHaveBeenCalled();
      }
    );

    it("leaves external folder links to Obsidian instead of opening a note creation flow (https://github.com/yydspanda/obsidian-copilot/issues/25)", async () => {
      const app = buildApp("C:/Vault");
      app.vault.getAbstractFileByPath.mockReturnValue({ path: "notes" });
      const link = await renderLink(app, "C:/Vault/notes", true);
      expect(link.click()).toBe(false);
      expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });

    it("leaves external file links to Obsidian on adapters without a desktop Vault root (https://github.com/yydspanda/obsidian-copilot/issues/25)", async () => {
      const app = buildApp("C:/Vault", ["notes/Source.md"]);
      app.vault.adapter = {};
      const link = await renderLink(app, "C:/Vault/notes/Source.md", true);
      expect(link.click()).toBe(false);
      expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });

    it("preserves the context menu for a right-click on a Vault source (https://github.com/yydspanda/obsidian-copilot/issues/25)", async () => {
      const app = buildApp("C:/Vault", ["notes/Source.md"]);
      const link = await renderLink(app, "C:/Vault/notes/Source.md", true);
      expect(link.click({ button: 2 })).toBe(false);
      expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });

    it("removes both source-link handlers when the rendered component unloads (https://github.com/yydspanda/obsidian-copilot/issues/25)", async () => {
      const app = buildApp("C:/Vault", ["notes/Source.md"]);
      const link = await renderLink(app, "C:/Vault/notes/Source.md", true);
      link.dispose();
      expect(link.click()).toBe(false);
      expect(link.click({ button: 1 })).toBe(false);
      expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });
  });
});
