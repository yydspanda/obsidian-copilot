import { openVaultPath } from "@/utils/openVaultPath";
import { getVaultBase, toVaultRelative } from "@/utils/vaultPath";
import { App, Component, MarkdownRenderer, TFile } from "obsidian";

type ModernRender = (
  app: App,
  markdown: string,
  el: HTMLElement,
  sourcePath: string,
  component: Component
) => Promise<void>;

export async function renderMarkdown(
  app: App,
  markdown: string,
  el: HTMLElement,
  sourcePath: string,
  component: Component
): Promise<void> {
  const render = (MarkdownRenderer as unknown as { render: ModernRender }).render;
  await render(app, markdown, el, sourcePath, component);
  wireVaultLinks(el, app, sourcePath, component);
}

function wireVaultLinks(el: HTMLElement, app: App, sourcePath: string, component: Component): void {
  const handleClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    const link = target?.closest?.("a.internal-link, a.external-link") as HTMLAnchorElement | null;
    if (!link || !el.contains(link)) return;
    if (e.button !== 0 && e.button !== 1) return;
    const raw = link.getAttribute("data-href") || link.getAttribute("href");
    if (!raw) return;
    let href: string;
    try {
      href = decodeURIComponent(raw);
    } catch {
      href = raw;
    }
    // Model source paths can render as external links; intercept only indexed Vault files, never traversal or creation targets. https://github.com/yydspanda/obsidian-copilot/issues/25
    if (!link.classList.contains("internal-link")) {
      const relative = toVaultRelative(href, getVaultBase(app));
      const filePath = relative.split("#", 1)[0];
      if (
        relative === href ||
        filePath.split("/").includes("..") ||
        !(app.vault.getAbstractFileByPath(filePath) instanceof TFile)
      )
        return;
      href = relative;
    }
    e.preventDefault();
    const newLeaf = e.button === 1 || e.ctrlKey || e.metaKey;
    openVaultPath(app, href, { newLeaf, sourcePath });
  };
  el.addEventListener("click", handleClick);
  el.addEventListener("auxclick", handleClick);
  component.register(() => {
    el.removeEventListener("click", handleClick);
    el.removeEventListener("auxclick", handleClick);
  });
}
