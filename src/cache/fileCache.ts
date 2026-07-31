import { logError, logInfo } from "@/logger";
import { md5 } from "@/utils/hash";
import { TFile, Vault } from "obsidian";

export interface FileCacheEntry<T> {
  content: T;
  timestamp: number;
}

/** Error thrown when a stale FileCache reference is used after disposal. */
export class FileCacheDisposedError extends Error {
  /**
   * Create a lifecycle error for a disposed FileCache.
   */
  public constructor() {
    super("FileCache has been disposed");
    this.name = "FileCacheDisposedError";
  }
}

export class FileCache<T> {
  private static instance?: FileCache<unknown>;
  private readonly cacheDir: string;
  private readonly vault: Vault;
  private memoryCache: Map<string, FileCacheEntry<T>> = new Map();
  private disposed = false;

  private constructor(cacheDir: string, vault: Vault) {
    this.cacheDir = cacheDir;
    this.vault = vault;
  }

  /**
   * Get the file cache owned by one exact Vault and cache directory.
   *
   * @param cacheDir - Vault-relative directory containing cached files
   * @param vault - Vault that owns both disk and memory cache state
   * @returns Active cache for the requested ownership tuple
   */
  static getInstance<T>(
    cacheDir: string = ".copilot/file-content-cache",
    vault: Vault = app.vault
  ): FileCache<T> {
    if (
      FileCache.instance &&
      (FileCache.instance.vault !== vault || FileCache.instance.cacheDir !== cacheDir)
    ) {
      FileCache.instance.dispose();
    }
    if (!FileCache.instance) {
      FileCache.instance = new FileCache<T>(cacheDir, vault);
    }
    return FileCache.instance as FileCache<T>;
  }

  /**
   * Reject work attempted through a cache from an ended Vault lifecycle.
   *
   * @throws FileCacheDisposedError when the cache has been disposed
   */
  private assertActive(): void {
    if (this.disposed) {
      throw new FileCacheDisposedError();
    }
  }

  /**
   * Release all in-memory data owned by this cache.
   *
   * Disposal never deletes persisted cache files. It is synchronous,
   * idempotent, and only clears the static singleton when this object owns it.
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.memoryCache.clear();
    if (FileCache.instance === this) {
      FileCache.instance = undefined;
    }
  }

  /**
   * Ensure the Vault-local cache directory exists.
   */
  private async ensureCacheDir(): Promise<void> {
    this.assertActive();
    const cacheDirectoryExists = await this.vault.adapter.exists(this.cacheDir);
    this.assertActive();
    if (!cacheDirectoryExists) {
      logInfo("Creating file cache directory:", this.cacheDir);
      await this.vault.adapter.mkdir(this.cacheDir);
      this.assertActive();
    }
  }

  getCacheKey(file: TFile, additionalContext?: string): string {
    this.assertActive();
    // Use file path, size and mtime for a unique but efficient cache key
    const metadata = `${file.path}:${file.stat.size}:${file.stat.mtime}${additionalContext ? `:${additionalContext}` : ""}`;
    return md5(metadata);
  }

  private getCachePath(cacheKey: string): string {
    return `${this.cacheDir}/${cacheKey}.md`;
  }

  async get(cacheKey: string): Promise<T | null> {
    this.assertActive();
    try {
      // Check memory cache first
      const memoryResult = this.memoryCache.get(cacheKey);
      if (memoryResult) {
        logInfo("Memory cache hit for file:", cacheKey);
        return memoryResult.content;
      }

      const cachePath = this.getCachePath(cacheKey);
      const cacheFileExists = await this.vault.adapter.exists(cachePath);
      this.assertActive();
      if (cacheFileExists) {
        logInfo("File cache hit:", cacheKey);
        const cacheContent = await this.vault.adapter.read(cachePath);
        this.assertActive();

        // .md files contain either plain string content or JSON-serialized content
        // The safest approach is to go back to a simpler method that doesn't try to embed metadata in the content itself.
        // Since preserving timestamps in file-based cache is not critical (memory cache handles active sessions)
        let parsedContent: T;

        // Try to parse as JSON first (for non-string types that were serialized)
        const trimmedContent = cacheContent.trim();
        if (
          (trimmedContent.startsWith("{") && trimmedContent.endsWith("}")) ||
          (trimmedContent.startsWith("[") && trimmedContent.endsWith("]"))
        ) {
          try {
            parsedContent = JSON.parse(cacheContent);
          } catch {
            // JSON parsing failed, treat as string content
            parsedContent = cacheContent as T;
          }
        } else {
          // Plain text content (primary case for markdown)
          parsedContent = cacheContent as T;
        }

        // Create cache entry for memory storage (file-based cache doesn't preserve timestamps)
        const cacheEntry: FileCacheEntry<T> = {
          content: parsedContent,
          timestamp: Date.now(),
        };

        // Store in memory cache
        this.memoryCache.set(cacheKey, cacheEntry);

        return cacheEntry.content;
      }

      logInfo("Cache miss for file:", cacheKey);
      return null;
    } catch (error) {
      if (error instanceof FileCacheDisposedError) {
        throw error;
      }
      logError("Error reading from file cache:", error);
      return null;
    }
  }

  async set(cacheKey: string, content: T): Promise<void> {
    this.assertActive();
    try {
      await this.ensureCacheDir();
      this.assertActive();
      const cachePath = this.getCachePath(cacheKey);

      const timestamp = Date.now();
      const cacheEntry: FileCacheEntry<T> = {
        content,
        timestamp,
      };

      // Store in memory cache
      this.memoryCache.set(cacheKey, cacheEntry);

      // Serialize content properly for file storage
      let serializedContent: string;
      if (typeof content === "string") {
        // If content is already a string, use it directly
        serializedContent = content;
      } else {
        // For non-string content, serialize as JSON
        serializedContent = JSON.stringify(content, null, 2);
      }

      await this.vault.adapter.write(cachePath, serializedContent);
      this.assertActive();
      logInfo("Cached file content:", cacheKey);
    } catch (error) {
      if (error instanceof FileCacheDisposedError) {
        throw error;
      }
      logError("Error writing to file cache:", error);
    }
  }

  async remove(cacheKey: string): Promise<void> {
    this.assertActive();
    try {
      // Remove from memory cache
      this.memoryCache.delete(cacheKey);

      // Remove from file cache (markdown format)
      const cachePath = this.getCachePath(cacheKey);
      const cacheFileExists = await this.vault.adapter.exists(cachePath);
      this.assertActive();
      if (cacheFileExists) {
        await this.vault.adapter.remove(cachePath);
        this.assertActive();
        logInfo("Removed file from cache:", cacheKey);
      }
    } catch (error) {
      if (error instanceof FileCacheDisposedError) {
        throw error;
      }
      logError("Error removing file from cache:", error);
    }
  }

  async clear(): Promise<void> {
    this.assertActive();
    try {
      // Clear memory cache
      this.memoryCache.clear();

      // Clear file cache
      const cacheDirectoryExists = await this.vault.adapter.exists(this.cacheDir);
      this.assertActive();
      if (cacheDirectoryExists) {
        const files = await this.vault.adapter.list(this.cacheDir);
        this.assertActive();
        logInfo("Clearing file cache, removing files:", files.files.length);

        for (const file of files.files) {
          this.assertActive();
          await this.vault.adapter.remove(file);
          this.assertActive();
        }
      }
    } catch (error) {
      if (error instanceof FileCacheDisposedError) {
        throw error;
      }
      logError("Error clearing file cache:", error);
    }
  }
}
