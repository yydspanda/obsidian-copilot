import { atom } from "jotai";
import { App, MetadataCache, TFile, TFolder, TAbstractFile, Vault } from "obsidian";
import { debounce } from "@/utils/debounce";
import { settingsStore } from "@/settings/model";
import { getTagsFromNote, isAllowedFileForNoteContext } from "@/utils";
import { logInfo } from "@/logger";

const VAULT_DEBOUNCE_DELAY = 250;

export const notesAtom = atom<TFile[]>([]);
export const foldersAtom = atom<TFolder[]>([]);
export const tagsFrontmatterAtom = atom<string[]>([]);
export const tagsAllAtom = atom<string[]>([]);

export class VaultDataManager {
  private static instance: VaultDataManager | null = null;
  private readonly app: App;
  private readonly vault: Vault;
  private readonly metadataCache: MetadataCache;
  private initialized = false;
  private disposed = false;

  private constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.metadataCache = app.metadataCache;
  }

  public static getInstance(app: App): VaultDataManager {
    const current = VaultDataManager.instance;
    if (current && !current.isOwnedBy(app)) {
      return VaultDataManager.startLifecycle(app);
    }
    if (!VaultDataManager.instance) {
      VaultDataManager.instance = new VaultDataManager(app);
    }
    return VaultDataManager.instance;
  }

  public static startLifecycle(app: App): VaultDataManager {
    const previous = VaultDataManager.instance;
    const replacement = new VaultDataManager(app);
    VaultDataManager.instance = replacement;
    previous?.cleanup();
    return replacement;
  }

  public initialize(): void {
    if (!this.isActiveOwner()) {
      return;
    }
    if (this.initialized) {
      logInfo("VaultDataManager: Already initialized, skipping");
      return;
    }
    logInfo("VaultDataManager: Initializing with vault event listeners");

    this.refreshNotes();
    this.refreshFolders();
    this.refreshTagsFrontmatter();
    this.refreshTagsAll();

    this.vault.on("create", this.handleFileCreate);
    this.vault.on("delete", this.handleFileDelete);
    this.vault.on("rename", this.handleFileRename);
    this.vault.on("modify", this.handleFileModify);
    this.metadataCache.on("changed", this.handleMetadataChange);

    this.initialized = true;
  }

  private isActiveOwner(): boolean {
    return !this.disposed && VaultDataManager.instance === this;
  }

  private isOwnedBy(app: App): boolean {
    return (
      !this.disposed &&
      this.app === app &&
      this.vault === app.vault &&
      this.metadataCache === app.metadataCache
    );
  }

  private handleFileCreate = (file: TAbstractFile): void => {
    if (!this.isActiveOwner()) return;
    if (file instanceof TFile) {
      if (isAllowedFileForNoteContext(file)) {
        this.debouncedRefreshNotes();
        this.debouncedRefreshTagsFrontmatter();
        this.debouncedRefreshTagsAll();
      }
    } else if (file instanceof TFolder) {
      this.debouncedRefreshFolders();
    }
  };

  private handleFileDelete = (file: TAbstractFile): void => {
    if (!this.isActiveOwner()) return;
    if (file instanceof TFile) {
      if (isAllowedFileForNoteContext(file)) {
        this.debouncedRefreshNotes();
        this.debouncedRefreshTagsFrontmatter();
        this.debouncedRefreshTagsAll();
      }
    } else if (file instanceof TFolder) {
      this.debouncedRefreshFolders();
    }
  };

  private handleFileRename = (file: TAbstractFile, _oldPath: string): void => {
    if (!this.isActiveOwner()) return;
    if (file instanceof TFile) {
      if (isAllowedFileForNoteContext(file)) {
        this.debouncedRefreshNotes();
        this.debouncedRefreshTagsFrontmatter();
        this.debouncedRefreshTagsAll();
      }
    } else if (file instanceof TFolder) {
      this.debouncedRefreshFolders();
    }
  };

  private handleFileModify = (file: TAbstractFile): void => {
    if (!this.isActiveOwner()) return;
    if (file instanceof TFile && file.extension === "md") {
      this.debouncedRefreshTagsAll();
    }
  };

  private handleMetadataChange = (file: TFile): void => {
    if (!this.isActiveOwner()) return;
    if (file.extension === "md") {
      this.debouncedRefreshTagsFrontmatter();
      this.debouncedRefreshTagsAll();
    }
  };

  private debouncedRefreshNotes = debounce(() => this.refreshNotes(), VAULT_DEBOUNCE_DELAY, {
    leading: true,
    trailing: true,
  });

  private debouncedRefreshFolders = debounce(() => this.refreshFolders(), VAULT_DEBOUNCE_DELAY, {
    leading: true,
    trailing: true,
  });

  private debouncedRefreshTagsFrontmatter = debounce(
    () => this.refreshTagsFrontmatter(),
    VAULT_DEBOUNCE_DELAY,
    {
      leading: true,
      trailing: true,
    }
  );

  private debouncedRefreshTagsAll = debounce(() => this.refreshTagsAll(), VAULT_DEBOUNCE_DELAY, {
    leading: true,
    trailing: true,
  });

  private refreshNotes = (): void => {
    if (!this.isActiveOwner()) return;

    const allFiles = this.vault.getFiles();
    const newFiles = allFiles.filter(
      (file): file is TFile => file instanceof TFile && isAllowedFileForNoteContext(file)
    );

    settingsStore.set(notesAtom, newFiles);
  };

  private refreshFolders = (): void => {
    if (!this.isActiveOwner()) return;

    const newFolders = this.vault
      .getAllLoadedFiles()
      .filter((file: TAbstractFile): file is TFolder => file instanceof TFolder);

    settingsStore.set(foldersAtom, newFolders);
  };

  private refreshTagsFrontmatter = (): void => {
    if (!this.isActiveOwner()) return;

    const tagSet = new Set<string>();

    this.vault.getMarkdownFiles().forEach((file: TFile) => {
      const fileTags = getTagsFromNote(this.app, file, true);
      fileTags.forEach((tag) => {
        const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
        tagSet.add(tagWithHash);
      });
    });

    const newTags = Array.from(tagSet).sort();

    settingsStore.set(tagsFrontmatterAtom, newTags);
  };

  private refreshTagsAll = (): void => {
    if (!this.isActiveOwner()) return;

    const tagSet = new Set<string>();

    this.vault.getMarkdownFiles().forEach((file: TFile) => {
      const fileTags = getTagsFromNote(this.app, file, false);
      fileTags.forEach((tag) => {
        const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
        tagSet.add(tagWithHash);
      });
    });

    const newTags = Array.from(tagSet).sort();

    settingsStore.set(tagsAllAtom, newTags);
  };

  public cleanup(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    logInfo("VaultDataManager: Cleaning up event listeners");

    this.debouncedRefreshNotes.cancel();
    this.debouncedRefreshFolders.cancel();
    this.debouncedRefreshTagsFrontmatter.cancel();
    this.debouncedRefreshTagsAll.cancel();

    this.vault.off("create", this.handleFileCreate);
    this.vault.off("delete", this.handleFileDelete);
    this.vault.off("rename", this.handleFileRename);
    this.vault.off("modify", this.handleFileModify);
    this.metadataCache.off("changed", this.handleMetadataChange);

    this.initialized = false;
    if (VaultDataManager.instance === this) {
      VaultDataManager.instance = null;
    }
  }

  public unload(): void {
    this.cleanup();
  }
}
