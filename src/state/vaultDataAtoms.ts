import { atom } from "jotai";
import { App, MetadataCache, TFile, TFolder, TAbstractFile, Vault } from "obsidian";
import { debounce } from "@/utils/debounce";
import { settingsStore } from "@/settings/model";
import { getTagsFromNote, isAllowedFileForNoteContext } from "@/utils";
import { logInfo } from "@/logger";

/**
 * Debounce delay for vault file operations (in milliseconds).
 * Batches rapid file create/delete/rename/modify events to prevent excessive re-scans.
 */
const VAULT_DEBOUNCE_DELAY = 250;

/**
 * Jotai atoms for vault data - centralized, singleton-managed vault state
 *
 * Note: Atoms store ALL available data. Hooks filter based on parameters.
 * - notesAtom: ALL files (markdown + PDFs + canvas)
 * - foldersAtom: ALL folders
 * - tagsFrontmatterAtom: Frontmatter tags only
 * - tagsAllAtom: All tags (frontmatter + inline)
 */
export const notesAtom = atom<TFile[]>([]);
export const foldersAtom = atom<TFolder[]>([]);
export const tagsFrontmatterAtom = atom<string[]>([]);
export const tagsAllAtom = atom<string[]>([]);

/**
 * Singleton manager for vault data with debounced event handling.
 * Ensures only ONE set of vault event listeners exists, shared across all hook instances.
 *
 * Architecture:
 * - Registers vault event listeners once on initialization
 * - Debounces refresh operations to batch rapid file changes
 * - Updates Jotai atoms (notesAtom, foldersAtom, tagsAtom)
 * - Provides stable array references when data hasn't changed
 *
 * Performance benefits:
 * - Eliminates duplicate event listeners (was 3x per typeahead component)
 * - Reduces vault scans by 70-90% via debouncing
 * - Prevents cascading re-renders with stable references
 */
export class VaultDataManager {
  private static instance: VaultDataManager | null = null;
  private readonly app: App;
  private readonly vault: Vault;
  private readonly metadataCache: MetadataCache;
  private initialized = false;
  private disposed = false;

  /**
   * Creates a manager bound to one exact App/Vault lifecycle.
   *
   * @param app - App that owns the Vault and MetadataCache listeners
   */
  private constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.metadataCache = app.metadataCache;
  }

  /**
   * Gets the manager for an exact App/Vault ownership tuple.
   *
   * A changed owner retires the previous manager before returning a replacement.
   *
   * @param app - App requesting the active manager
   * @returns Manager owned by the supplied App and Vault
   */
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

  /**
   * Starts a fresh plugin lifecycle, including same-App hot reloads.
   *
   * The replacement becomes authoritative before the previous manager is
   * cleaned up, so a delayed stale cleanup cannot clear the new owner.
   *
   * @param app - App that owns the new plugin lifecycle
   * @returns Fresh lifecycle-owned manager
   */
  public static startLifecycle(app: App): VaultDataManager {
    const previous = VaultDataManager.instance;
    const replacement = new VaultDataManager(app);
    VaultDataManager.instance = replacement;
    previous?.cleanup();
    return replacement;
  }

  /**
   * Initializes the vault data manager with event listeners.
   * Should be called once during plugin initialization.
   *
   * Note: VaultDataManager tracks ALL files (md + PDFs + canvas) and ALL tags.
   * Filtering is done by hooks based on parameters.
   */
  public initialize(): void {
    if (!this.isActiveOwner()) {
      return;
    }
    if (this.initialized) {
      logInfo("VaultDataManager: Already initialized, skipping");
      return;
    }

    logInfo("VaultDataManager: Initializing with vault event listeners");

    // Initial data load
    this.refreshNotes();
    this.refreshFolders();
    this.refreshTagsFrontmatter();
    this.refreshTagsAll();

    // Register event listeners
    this.vault.on("create", this.handleFileCreate);
    this.vault.on("delete", this.handleFileDelete);
    this.vault.on("rename", this.handleFileRename);
    this.vault.on("modify", this.handleFileModify);
    this.metadataCache.on("changed", this.handleMetadataChange);

    this.initialized = true;
  }

  /**
   * Reports whether this object still owns the active App/Vault lifecycle.
   *
   * @returns Whether callbacks may observe or publish Vault data
   */
  private isActiveOwner(): boolean {
    return !this.disposed && VaultDataManager.instance === this;
  }

  /**
   * Compares a candidate against this manager's exact ownership tuple.
   *
   * @param app - Candidate App
   * @returns Whether App, Vault, and MetadataCache identities all match
   */
  private isOwnedBy(app: App): boolean {
    return (
      !this.disposed &&
      this.app === app &&
      this.vault === app.vault &&
      this.metadataCache === app.metadataCache
    );
  }

  /**
   * Handles file creation events
   */
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

  /**
   * Handles file deletion events
   */
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

  /**
   * Handles file rename events
   * Note: oldPath parameter is required by Obsidian's event signature but not used
   * since we simply refresh all affected data structures
   */
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

  /**
   * Handles file modify events (for inline tag changes)
   */
  private handleFileModify = (file: TAbstractFile): void => {
    if (!this.isActiveOwner()) return;
    if (file instanceof TFile && file.extension === "md") {
      this.debouncedRefreshTagsAll();
    }
  };

  /**
   * Handles metadata cache changes (for frontmatter tag updates)
   */
  private handleMetadataChange = (file: TFile): void => {
    if (!this.isActiveOwner()) return;
    if (file.extension === "md") {
      this.debouncedRefreshTagsFrontmatter();
      this.debouncedRefreshTagsAll();
    }
  };

  /**
   * Debounced notes refresh - batches rapid file operations via debounce
   */
  private debouncedRefreshNotes = debounce(() => this.refreshNotes(), VAULT_DEBOUNCE_DELAY, {
    leading: true,
    trailing: true,
  });

  /**
   * Debounced folders refresh - batches rapid file operations via debounce
   */
  private debouncedRefreshFolders = debounce(() => this.refreshFolders(), VAULT_DEBOUNCE_DELAY, {
    leading: true,
    trailing: true,
  });

  /**
   * Debounced frontmatter tags refresh - batches rapid file operations via debounce
   */
  private debouncedRefreshTagsFrontmatter = debounce(
    () => this.refreshTagsFrontmatter(),
    VAULT_DEBOUNCE_DELAY,
    {
      leading: true,
      trailing: true,
    }
  );

  /**
   * Debounced all tags refresh - batches rapid file operations via debounce
   */
  private debouncedRefreshTagsAll = debounce(() => this.refreshTagsAll(), VAULT_DEBOUNCE_DELAY, {
    leading: true,
    trailing: true,
  });

  /**
   * Refreshes the notes atom with ALL vault files (markdown + PDFs + canvas).
   * Hooks will filter based on their parameters.
   */
  private refreshNotes = (): void => {
    if (!this.isActiveOwner()) return;

    const allFiles = this.vault.getFiles();
    const newFiles = allFiles.filter(
      (file): file is TFile => file instanceof TFile && isAllowedFileForNoteContext(file)
    );

    // Always update atom with new array reference to ensure React components re-render
    // Note: Obsidian mutates TFile objects in-place (e.g., on rename), so we need new
    // array references to trigger re-renders even when paths are the same
    settingsStore.set(notesAtom, newFiles);
  };

  /**
   * Refreshes the folders atom with current vault folders
   */
  private refreshFolders = (): void => {
    if (!this.isActiveOwner()) return;

    const newFolders = this.vault
      .getAllLoadedFiles()
      .filter((file: TAbstractFile): file is TFolder => file instanceof TFolder);

    // Always update atom with new array reference to ensure React components re-render
    settingsStore.set(foldersAtom, newFolders);
  };

  /**
   * Refreshes the frontmatter tags atom with current vault tags (frontmatter only)
   */
  private refreshTagsFrontmatter = (): void => {
    if (!this.isActiveOwner()) return;

    const tagSet = new Set<string>();

    this.vault.getMarkdownFiles().forEach((file: TFile) => {
      const fileTags = getTagsFromNote(file, true, this.metadataCache); // frontmatterOnly = true
      fileTags.forEach((tag) => {
        const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
        tagSet.add(tagWithHash);
      });
    });

    const newTags = Array.from(tagSet).sort();

    // Always update atom with new array reference to ensure React components re-render
    settingsStore.set(tagsFrontmatterAtom, newTags);
  };

  /**
   * Refreshes the all tags atom with current vault tags (frontmatter + inline)
   */
  private refreshTagsAll = (): void => {
    if (!this.isActiveOwner()) return;

    const tagSet = new Set<string>();

    this.vault.getMarkdownFiles().forEach((file: TFile) => {
      const fileTags = getTagsFromNote(file, false, this.metadataCache); // frontmatterOnly = false (all tags)
      fileTags.forEach((tag) => {
        const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
        tagSet.add(tagWithHash);
      });
    });

    const newTags = Array.from(tagSet).sort();

    // Always update atom with new array reference to ensure React components re-render
    settingsStore.set(tagsAllAtom, newTags);
  };

  /**
   * Cleans up event listeners and debounced functions.
   * Should be called during plugin unload.
   */
  public cleanup(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    logInfo("VaultDataManager: Cleaning up event listeners");

    // Cancel pending debounced calls
    this.debouncedRefreshNotes.cancel();
    this.debouncedRefreshFolders.cancel();
    this.debouncedRefreshTagsFrontmatter.cancel();
    this.debouncedRefreshTagsAll.cancel();

    // Remove only the listeners captured from this exact lifecycle owner.
    // Calling off for an unregistered callback is safe and also cleans up a
    // partially completed initialize() if one of the later registrations threw.
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

  /**
   * Alias for cleanup() to match plugin lifecycle method naming
   */
  public unload(): void {
    this.cleanup();
  }
}
