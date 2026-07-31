import { ProjectConfig } from "@/aiParams";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { logError, logInfo, logWarn } from "@/logger";
import { COPILOT_PROJECT_ID, PROJECTS_UNSUPPORTED_FOLDER_NAME } from "@/projects/constants";
import { deriveProjectFolderName, sanitizeVaultPathSegment } from "@/projects/projectPaths";
import {
  createProjectStateOwnerAssertion,
  ensureProjectFrontmatter,
  getProjectConfigFilePath,
  getProjectFolderPath,
  getProjectsFolder,
  getProjectsUnsupportedFolder,
  readFrontmatterFieldFromFile,
  scanAllProjectConfigFiles,
  writeProjectFrontmatter,
} from "@/projects/projectUtils";
import {
  acquireProjectFileWrite,
  isProjectStateOwnerActive,
  ProjectFileWriteLease,
  ProjectStateOwner,
  releaseProjectFileWrite,
} from "@/projects/state";
import { getSettings, updateSetting } from "@/settings/model";
import { ensureFolderExists, stripFrontmatter } from "@/utils";
import { App, Notice, parseYaml, TFile, TFolder, Vault } from "obsidian";
import { trashFile } from "@/utils/vaultAdapterUtils";

/**
 * Normalize line endings for content comparison (avoid CRLF/LF mismatches).
 */
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Save a failed migration project to unsupported/ directory as recovery backup.
 * Best-effort: ordinary backup failures are logged and suppressed. Lifecycle
 * cancellation still propagates so an obsolete owner cannot continue migration.
 *
 * @param vault - Vault instance
 * @param project - Original project config
 * @param reason - Failure reason
 * @param assertOwnerActive - Assertion bound to the lifecycle that started migration
 * @returns true if a new backup was created, false if it already existed or backup failed
 */
async function saveFailedProjectToUnsupported(
  vault: Vault,
  project: ProjectConfig,
  reason: string,
  assertOwnerActive: () => void
): Promise<boolean> {
  try {
    const unsupportedFolder = getProjectsUnsupportedFolder();
    assertOwnerActive();
    await ensureFolderExists(unsupportedFolder, vault, assertOwnerActive);
    assertOwnerActive();

    const safeId = sanitizeVaultPathSegment(project.id || "unknown") || "unknown";
    // Reason: use deterministic base name so repeated migration runs don't create duplicate
    // backups for the same project. Add a collision suffix when different projects sanitize
    // to the same id (e.g. "a/b" and "a\\b" both become "a_b").
    const baseName = `Project Migration Failed - ${safeId}`;
    let filePath = `${unsupportedFolder}/${baseName}.md`;
    let suffix = 2;
    // Reason: use adapter.exists() instead of vault.getAbstractFileByPath() because
    // hidden folders are not indexed in the vault cache.
    while (true) {
      assertOwnerActive();
      const backupExists = await vault.adapter.exists(filePath);
      assertOwnerActive();
      if (!backupExists) break;

      // Reason: skip only when the existing backup is structurally identical (same id AND content).
      // Duplicate-id entries with different content (e.g. different systemPrompt/name) must each
      // get their own backup, otherwise the second one is unrecoverable after projectList is cleared.
      if (suffix === 2) {
        try {
          assertOwnerActive();
          const existingContent = await vault.adapter.read(filePath);
          assertOwnerActive();
          const jsonMatch = existingContent.match(/```json\s*\n([\s\S]*?)\n```/);
          if (jsonMatch) {
            const backedUpProject = JSON.parse(jsonMatch[1]);
            // Reason: compare full JSON to detect same-id but different-content duplicates.
            if (JSON.stringify(backedUpProject) === JSON.stringify(project)) return false;
          }
        } catch {
          assertOwnerActive();
          // Can't verify — treat as collision and create suffixed backup
        }
      }
      filePath = `${unsupportedFolder}/${baseName} - ${suffix}.md`;
      suffix++;
      if (suffix > 20) {
        logWarn(`[Projects] Too many backup collisions for safeId="${safeId}", giving up`);
        return false;
      }
    }

    const content = [
      `> Projects migration failed: ${reason}`,
      ">",
      "> This file is an automatic backup (unsupported/), for manual recovery.",
      "> You can recreate the project from the JSON below, or fix and re-migrate.",
      "",
      "```json",
      JSON.stringify(project, null, 2),
      "```",
      "",
    ].join("\n");

    assertOwnerActive();
    await vault.create(filePath, content);
    assertOwnerActive();
    return true;
  } catch (backupError) {
    // A superseded lifecycle must stop without logging or initiating recovery work.
    assertOwnerActive();
    // Reason: backup failure must not crash migration loop or cause legacy data loss
    logError(
      `[Projects] Failed to save unsupported backup for project id=${project.id || "unknown"}`,
      backupError
    );
    return false;
  }
}

/**
 * Best-effort rollback: delete a file and its parent folder if empty.
 * Logs ordinary errors but propagates lifecycle cancellation.
 *
 * @param app - App that owns the target Vault
 * @param filePath - Created file to remove
 * @param folderPath - Parent folder to remove when empty
 * @param assertOwnerActive - Assertion bound to the lifecycle that created the file
 */
async function rollbackCreatedFile(
  app: App,
  filePath: string,
  folderPath: string,
  assertOwnerActive: () => void
): Promise<void> {
  const vault = app.vault;
  try {
    assertOwnerActive();
    const file = vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      assertOwnerActive();
      await trashFile(app, file);
      assertOwnerActive();
    } else {
      assertOwnerActive();
      const fileExists = await vault.adapter.exists(filePath);
      assertOwnerActive();
      if (fileExists) {
        // Reason: hidden-folder files are not indexed by vault cache.
        // Fall back to adapter-based deletion for consistent hidden-folder support.
        assertOwnerActive();
        await vault.adapter.remove(filePath);
        assertOwnerActive();
      }
    }

    assertOwnerActive();
    const folder = vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder && folder.children.length === 0) {
      assertOwnerActive();
      await trashFile(app, folder);
      assertOwnerActive();
    } else {
      assertOwnerActive();
      const folderExists = await vault.adapter.exists(folderPath);
      assertOwnerActive();
      if (folderExists) {
        assertOwnerActive();
        const listing = await vault.adapter.list(folderPath);
        assertOwnerActive();
        if (listing.files.length === 0 && listing.folders.length === 0) {
          assertOwnerActive();
          await vault.adapter.rmdir(folderPath, false);
          assertOwnerActive();
        }
      }
    }
  } catch (rollbackError) {
    // Never let an earlier lifecycle roll back files after a newer owner takes over.
    assertOwnerActive();
    logError(`[Projects] Migration rollback failed for ${filePath}`, rollbackError);
  }
}

/**
 * Write a single project to a vault file with full frontmatter.
 *
 * @param app - App that owns the target Vault
 * @param owner - Active Projects state lifecycle owner
 * @param project - ProjectConfig to write
 * @param folderName - Target folder name (typically the project id)
 * @param assertOwnerActive - Assertion bound to the lifecycle that started migration
 * @returns The created TFile (for hidden-folder compatibility, avoids re-fetching via vault cache)
 */
async function writeProjectToVaultFile(
  app: App,
  owner: ProjectStateOwner,
  project: ProjectConfig,
  folderName: string,
  assertOwnerActive: () => void
): Promise<TFile> {
  const vault = app.vault;
  const projectsFolder = getProjectsFolder();
  assertOwnerActive();
  await ensureFolderExists(projectsFolder, vault, assertOwnerActive);
  assertOwnerActive();
  await ensureFolderExists(`${projectsFolder}/${folderName}`, vault, assertOwnerActive);
  assertOwnerActive();

  const filePath = getProjectConfigFilePath(folderName);

  const folderPath = `${projectsFolder}/${folderName}`;

  const fileWriteLease = acquireProjectFileWrite(owner, filePath);
  if (!fileWriteLease) {
    throw new Error("Projects lifecycle ended before migration write");
  }
  try {
    // Reason: use vault.create() return value directly for hidden folder compatibility.
    assertOwnerActive();
    const file = await vault.create(filePath, project.systemPrompt || "");
    assertOwnerActive();

    const now = Date.now();
    const createdMs =
      Number.isFinite(project.created) && project.created > 0 ? project.created : now;
    const lastUsedMs =
      Number.isFinite(project.UsageTimestamps) && project.UsageTimestamps > 0
        ? project.UsageTimestamps
        : 0;

    try {
      await writeProjectFrontmatter(
        app,
        file,
        project,
        folderName,
        {
          createdMs,
          lastUsedMs,
        },
        assertOwnerActive
      );
      assertOwnerActive();
    } catch (fmError) {
      // Reason: rollback the created file to avoid leaving a "poisoned" file without frontmatter
      assertOwnerActive();
      await rollbackCreatedFile(app, filePath, folderPath, assertOwnerActive);
      assertOwnerActive();
      throw fmError;
    }

    return file;
  } finally {
    releaseProjectFileWrite(fileWriteLease);
  }
}

/**
 * Write-then-verify: check that migrated file content matches original systemPrompt.
 * Aligned with system-prompts migration verification strategy.
 *
 * @param vault - Vault instance
 * @param fileOrPath - TFile or string path (for hidden-folder compatibility)
 * @param originalSystemPrompt - Expected body content
 * @param assertOwnerActive - Assertion bound to the lifecycle that started migration
 */
async function verifyMigratedContent(
  vault: Vault,
  fileOrPath: TFile | string,
  originalSystemPrompt: string,
  assertOwnerActive: () => void
): Promise<boolean> {
  try {
    // Reason: support both TFile (normal folders) and string path (hidden folders)
    assertOwnerActive();
    const rawContent =
      fileOrPath instanceof TFile
        ? await vault.read(fileOrPath)
        : await vault.adapter.read(fileOrPath);
    assertOwnerActive();
    const savedContent = stripFrontmatter(rawContent, { trimStart: false });

    const savedNorm = normalizeLineEndings(savedContent).replace(/^\n+/, "");
    const originalNorm = normalizeLineEndings(originalSystemPrompt || "").replace(/^\n+/, "");

    if (savedNorm !== originalNorm) {
      logWarn(
        `[Projects] Migration verify failed: content mismatch. ` +
          `Expected ${originalNorm.length} chars, got ${savedNorm.length} chars`
      );
      return false;
    }
    return true;
  } catch (error) {
    assertOwnerActive();
    logError("[Projects] Migration verify failed: unable to read back file", error);
    return false;
  }
}

/**
 * Derive the migration folder name from project name (preferred) or id (fallback).
 * Delegates to the shared deriveProjectFolderName utility in projectPaths.ts.
 */
function getMigrationFolderName(projectId: string, projectName?: string): string {
  return deriveProjectFolderName(projectId, projectName);
}

/**
 * Execute project migration from data.json (settings.projectList) to vault files.
 *
 * Safety guarantees:
 * - write-then-verify: each file is read back and verified
 * - unsupported/ backup: failed items are backed up for manual recovery
 * - dirty data defense: skip duplicate ids, empty ids
 * - retry-safe: already-migrated projects (target file exists with matching id) are skipped
 * - clear-on-success: projectList entries are removed only for successfully migrated projects
 *
 * @param app - Obsidian App instance
 * @param owner - Active Projects state lifecycle owner
 */
export async function migrateProjectsFromSettingsToVault(
  app: App,
  owner: ProjectStateOwner
): Promise<void> {
  const assertOwnerActive = createProjectStateOwnerAssertion(owner);
  assertOwnerActive();

  const vault = app.vault;
  const settings = getSettings();
  const legacyProjects = settings.projectList || [];

  if (legacyProjects.length === 0) {
    assertOwnerActive();
    logInfo("[Projects] No legacy projects to migrate");
    return;
  }

  assertOwnerActive();
  logInfo(`[Projects] Migrating ${legacyProjects.length} legacy projects to vault files...`);

  const migratedEntries: ProjectConfig[] = [];
  const seenIds = new Set<string>();
  // Reason: track sanitized folder names (case-insensitive) to detect collisions where
  // different ids map to the same folder. Case-insensitive because macOS/Windows vaults
  // have case-insensitive filesystems (e.g. "MyProject" and "myproject" collide on disk).
  const seenFolderNames = new Map<string, string>(); // lowercase folderName -> first project id

  for (const project of legacyProjects) {
    assertOwnerActive();
    const id = (project.id || "").trim();

    // Dirty data defense: skip empty ids
    if (!id) {
      logWarn("[Projects] Skip migrating project with empty id");
      await saveFailedProjectToUnsupported(vault, project, "empty project id", assertOwnerActive);
      assertOwnerActive();
      continue;
    }

    // Dirty data defense: skip duplicate ids
    if (seenIds.has(id)) {
      logWarn(`[Projects] Skip migrating duplicate project id: ${id}`);
      await saveFailedProjectToUnsupported(
        vault,
        project,
        `duplicate project id: ${id}`,
        assertOwnerActive
      );
      assertOwnerActive();
      continue;
    }
    seenIds.add(id);

    const folderName = getMigrationFolderName(id, project.name);

    // Dirty data defense: skip folder name collisions (case-insensitive for cross-platform safety)
    const folderKey = folderName.toLowerCase();
    const firstIdForFolder = seenFolderNames.get(folderKey);
    if (firstIdForFolder) {
      logWarn(
        `[Projects] Skip migrating project id="${id}": folder name "${folderName}" ` +
          `collides with id="${firstIdForFolder}"`
      );
      await saveFailedProjectToUnsupported(
        vault,
        project,
        `folder name collision: "${folderName}" already used by id="${firstIdForFolder}"`,
        assertOwnerActive
      );
      assertOwnerActive();
      continue;
    }
    seenFolderNames.set(folderKey, id);
    const filePath = getProjectConfigFilePath(folderName);

    // Retry-safety: if target file already exists from a prior partial migration, skip it
    // but only if the frontmatter id matches (to avoid treating conflict files as successful)
    // Reason: use adapter.exists() as primary check for hidden-folder compatibility.
    // getAbstractFileByPath() returns null for hidden folders not indexed by vault cache.
    assertOwnerActive();
    const existingFile = vault.getAbstractFileByPath(filePath);
    let fileExistsOnDisk = existingFile instanceof TFile;
    if (!fileExistsOnDisk) {
      assertOwnerActive();
      fileExistsOnDisk = await vault.adapter.exists(filePath);
      assertOwnerActive();
    }
    if (fileExistsOnDisk) {
      // Try metadataCache first (fast path), fall back to reading file content directly
      // Reason: metadataCache may not be ready on startup, returning null frontmatter
      // which would cause false conflict detection and unnecessary unsupported backups
      let existingId = "";
      if (existingFile instanceof TFile) {
        const existingMeta = app.metadataCache.getFileCache(existingFile);
        existingId = String(existingMeta?.frontmatter?.[COPILOT_PROJECT_ID] ?? "").trim();
        if (!existingId) {
          assertOwnerActive();
          existingId = await readFrontmatterFieldFromFile(vault, existingFile, COPILOT_PROJECT_ID);
          assertOwnerActive();
        }
      } else {
        // Reason: hidden-folder file — read frontmatter id via adapter since TFile is unavailable.
        // Use parseYaml (same as normal path in projectUtils) to handle quoted values, comments,
        // and other YAML formatting that simple regex would miss on reruns.
        try {
          assertOwnerActive();
          const raw = await vault.adapter.read(filePath);
          assertOwnerActive();
          const fmMatch = raw.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (fmMatch) {
            const parsed = parseYaml(fmMatch[1]);
            if (parsed && typeof parsed === "object") {
              const raw = (parsed as Record<string, unknown>)[COPILOT_PROJECT_ID];
              existingId = (typeof raw === "string" ? raw : "").trim();
            }
          }
        } catch {
          assertOwnerActive();
          existingId = "";
        }
      }

      // Reason: compare against raw id since writeProjectFrontmatter now preserves
      // the original id. Both the legacy id and the persisted id should match directly.
      if (existingId === id) {
        // Reason: verify content on retry to avoid cementing a previously truncated/corrupted file.
        // Without this, a partial first-run write would be skipped on rerun and counted as success.
        const verified = await verifyMigratedContent(
          vault,
          existingFile instanceof TFile ? existingFile : filePath,
          project.systemPrompt || "",
          assertOwnerActive
        );
        assertOwnerActive();
        if (verified) {
          // Reason: a partial prior migration may have written body content but incomplete
          // frontmatter. Repair any missing fields using the authoritative legacy data.
          // ensureProjectFrontmatter is idempotent — only fills null fields, never overwrites.
          // Skip for hidden-folder files where TFile is unavailable (frontmatter was already
          // written by the initial migration — can't process frontmatter without a TFile).
          if (existingFile instanceof TFile) {
            try {
              const folderNameForRepair = getMigrationFolderName(id, project.name);
              await ensureProjectFrontmatter(app, owner, existingFile, {
                project,
                filePath,
                folderName: folderNameForRepair,
              });
              assertOwnerActive();
            } catch (repairError) {
              assertOwnerActive();
              logWarn(
                `[Projects] Failed to repair frontmatter for id=${id}, continuing`,
                repairError
              );
            }
          }
          logInfo(
            `[Projects] Migration skip: target file already exists for id=${id} at ${filePath}`
          );
          // Reason: existing verified file counts as successfully migrated — clear from settings
          migratedEntries.push(project);
          continue;
        }

        logWarn(`[Projects] Migration verify failed on existing file for id=${id} at ${filePath}`);
        await saveFailedProjectToUnsupported(
          vault,
          project,
          `existing file content mismatch at ${filePath} (delete/rename the file and re-run migration)`,
          assertOwnerActive
        );
        assertOwnerActive();
        continue;
      }

      // File exists but id doesn't match — treat as conflict
      logWarn(
        `[Projects] Migration conflict: ${filePath} exists with id="${existingId}" but expected "${id}"`
      );
      await saveFailedProjectToUnsupported(
        vault,
        project,
        `target file exists at ${filePath} with mismatched id="${existingId}"`,
        assertOwnerActive
      );
      assertOwnerActive();
      continue;
    }

    try {
      const file = await writeProjectToVaultFile(
        app,
        owner,
        project,
        folderName,
        assertOwnerActive
      );
      assertOwnerActive();

      const verified = await verifyMigratedContent(
        vault,
        file,
        project.systemPrompt || "",
        assertOwnerActive
      );
      assertOwnerActive();
      if (!verified) {
        // Reason: rollback the just-created file to prevent a permanent retry-failure loop.
        // Without this, the existing-file branch on next restart re-detects, re-verifies,
        // and fails again indefinitely.
        const folderPath = `${getProjectsFolder()}/${folderName}`;
        await rollbackCreatedFile(app, file.path, folderPath, assertOwnerActive);
        assertOwnerActive();
        await saveFailedProjectToUnsupported(
          vault,
          project,
          "content verification mismatch",
          assertOwnerActive
        );
        assertOwnerActive();
      } else {
        migratedEntries.push(project);
      }
    } catch (error) {
      assertOwnerActive();
      const msg = error instanceof Error ? error.message : String(error);
      logError(`[Projects] Failed to migrate project id=${id}`, error);
      await saveFailedProjectToUnsupported(vault, project, msg, assertOwnerActive);
      assertOwnerActive();
    }
  }

  // Reason: unconditionally clear ALL legacy entries from projectList.
  // This follows the same pattern as custom command migration (commands/migrator.ts):
  //   - Failed projects are already backed up to unsupported/ for manual recovery
  //   - Keeping failed entries would create a dual source of truth (settings + vault files)
  //     which causes: startup dialog spam on every launch, stale-state bugs when users
  //     edit/delete merged projects, and sync conflicts across devices
  //   - The unsupported/ folder is the single recovery path for failed migrations
  //   - If backup itself fails (extremely rare — requires filesystem write failure),
  //     data loss is accepted as an edge case not worth the complexity of tracking
  //     per-entry backup outcomes and retaining partial projectList state
  assertOwnerActive();
  updateSetting("projectList", []);
  assertOwnerActive();

  const successCount = migratedEntries.length;
  const failedCount = legacyProjects.length - successCount;
  const projectsFolder = getProjectsFolder();
  const unsupportedFolder = getProjectsUnsupportedFolder();

  // Reason: reveal the target folder in Obsidian's file explorer so users can
  // quickly navigate to their migrated project files or unsupported backups.
  const revealFolderInExplorer = (folderPath: string) => {
    // The modal can outlive this plugin lifecycle. Ignore clicks from an obsolete owner.
    if (!isProjectStateOwnerActive(owner)) return;

    const folder = vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) {
      // Reason: use the internal file-explorer plugin API to reveal and highlight the folder.
      const fileExplorer = (
        app as unknown as {
          internalPlugins?: {
            getPluginById?: (id: string) =>
              | {
                  enabled?: boolean;
                  instance?: { revealInFolder?: (folder: TFolder) => void };
                }
              | undefined;
          };
        }
      ).internalPlugins?.getPluginById?.("file-explorer");
      if (fileExplorer?.enabled && fileExplorer.instance?.revealInFolder) {
        fileExplorer.instance.revealInFolder(folder);
      }
    } else {
      // Reason: hidden-folder files are not in vault cache, so revealInFolder silently fails.
      new Notice(`Folder "${folderPath}" is hidden and cannot be revealed in Obsidian's explorer.`);
    }
  };

  assertOwnerActive();
  if (failedCount === 0) {
    logInfo(
      `[Projects] Migration succeeded: all ${successCount} project(s) migrated to vault files`
    );
    new ConfirmModal(
      app,
      () => revealFolderInExplorer(projectsFolder),
      `Your projects have been upgraded to the new file-based format. They are now stored in: ${projectsFolder}\n\nYou can now:\n• Edit project settings directly in the file\n• View and manage project files in the vault\n• All ${successCount} project(s) were migrated successfully.`,
      "🚀 Projects Upgraded",
      "Show in Folder",
      "OK"
    ).open();
  } else if (successCount > 0) {
    logWarn(
      `[Projects] Migration partially succeeded: ${successCount} migrated, ${failedCount} failed`
    );
    new ConfirmModal(
      app,
      () => revealFolderInExplorer(projectsFolder),
      `⚠️ Projects migration partially completed.\n\n✅ ${successCount} project(s) migrated successfully.\n❌ ${failedCount} project(s) failed — their data has been backed up to:\n${unsupportedFolder}\n\nYou can manually recover failed projects from the unsupported folder.`,
      "⚠️ Projects Migration: Partial Success",
      "Show in Folder",
      "OK"
    ).open();
  } else {
    logWarn("[Projects] Migration failed: no projects were migrated");
    new ConfirmModal(
      app,
      () => revealFolderInExplorer(unsupportedFolder),
      `⚠️ Projects migration could not be completed.\n\nYour project data has been backed up to:\n${unsupportedFolder}\n\nTo recover:\n1. Open the files in the unsupported folder\n2. Review the content\n3. Recreate the projects manually`,
      "⚠️ Projects Migration Failed",
      "Show in Folder",
      "OK"
    ).open();
  }
}

/**
 * Migrate existing project folders from id-based to name-based naming.
 * Scans all project config files and renames folders where the current folder name
 * doesn't match the sanitized project name.
 *
 * This is idempotent: projects already using name-based folders are skipped.
 * Collisions are handled gracefully (skip with warning).
 *
 * @param app - App that owns the target Vault
 * @param owner - Active Projects state lifecycle owner
 */
async function migrateProjectFolderNames(app: App, owner: ProjectStateOwner): Promise<void> {
  const assertOwnerActive = createProjectStateOwnerAssertion(owner);
  assertOwnerActive();

  const vault = app.vault;
  const { records } = await scanAllProjectConfigFiles(app);
  assertOwnerActive();
  if (records.length === 0) return;

  let renamed = 0;
  const projectsFolder = getProjectsFolder();
  // Reason: track reserved lowercase folder names to prevent case-insensitive collisions
  // (e.g. "Foo" and "foo" both targeting the same path on macOS/Windows).
  // Matches the same guard used in createProject() and updateProject().
  const reservedLowerNames = new Map<string, string>(); // lowercase folderName -> project id
  for (const r of records) {
    reservedLowerNames.set(r.folderName.toLowerCase(), r.project.id);
  }

  for (const record of records) {
    assertOwnerActive();
    const name = (record.project.name || "").trim();
    if (!name) continue; // No name to derive folder from

    const expectedFolder = sanitizeVaultPathSegment(name);
    // Reason: handle reserved "unsupported" folder name
    const safeFolderName =
      expectedFolder.toLowerCase() === PROJECTS_UNSUPPORTED_FOLDER_NAME
        ? `_${expectedFolder}`
        : expectedFolder;

    if (safeFolderName === record.folderName) continue; // Already correct

    const newFolderPath = `${projectsFolder}/${safeFolderName}`;
    const oldFolderPath = getProjectFolderPath(record.folderName);
    const oldFilePath = record.filePath;
    const newFilePath = getProjectConfigFilePath(safeFolderName);

    // Reason: case-insensitive collision guard — skip if another project already
    // occupies or is targeting this lowercase folder name (cross-platform safety).
    const lowerTarget = safeFolderName.toLowerCase();
    const existingOwner = reservedLowerNames.get(lowerTarget);
    if (existingOwner && existingOwner !== record.project.id) {
      logWarn(
        `[Projects] Naming migration skip: folder "${safeFolderName}" collides (case-insensitive) ` +
          `with project id="${existingOwner}" for project id="${record.project.id}"`
      );
      continue;
    }

    // Reason: on case-insensitive filesystems (macOS/Windows), a case-only rename
    // (e.g. "foo" → "Foo") reports the old folder as "already existing". Skip the
    // disk-conflict check when the paths differ only in case. This matches the
    // guard in ProjectFileManager.updateProject().
    const isCaseOnlyRename = newFolderPath.toLowerCase() === oldFolderPath.toLowerCase();
    let targetExists = false;
    if (!isCaseOnlyRename) {
      assertOwnerActive();
      targetExists = await vault.adapter.exists(newFolderPath);
      assertOwnerActive();
    }
    if (targetExists) {
      logWarn(
        `[Projects] Naming migration skip: target folder "${newFolderPath}" already exists ` +
          `for project id="${record.project.id}"`
      );
      continue;
    }

    const fileWriteLeases: ProjectFileWriteLease[] = [];
    try {
      // Suppress vault events during rename
      assertOwnerActive();
      const oldFileWriteLease = acquireProjectFileWrite(owner, oldFilePath);
      const newFileWriteLease = acquireProjectFileWrite(owner, newFilePath);
      if (!oldFileWriteLease || !newFileWriteLease) {
        if (oldFileWriteLease) releaseProjectFileWrite(oldFileWriteLease);
        if (newFileWriteLease) releaseProjectFileWrite(newFileWriteLease);
        return;
      }
      fileWriteLeases.push(oldFileWriteLease, newFileWriteLease);

      // Reason: use vault.rename() for cache-visible folders so the vault cache updates
      // synchronously. adapter.rename() would leave stale TFolder.children until Obsidian
      // refreshes its cache, causing the subsequent scanAllProjectConfigFiles() to miss
      // renamed projects. Fall back to adapter.rename() for hidden folders.
      const folderObj = vault.getAbstractFileByPath(oldFolderPath);
      assertOwnerActive();
      if (folderObj instanceof TFolder) {
        await vault.rename(folderObj, newFolderPath);
      } else {
        await vault.adapter.rename(oldFolderPath, newFolderPath);
      }
      assertOwnerActive();
      renamed++;
      // Update reserved names: release old folder name, claim the new one
      reservedLowerNames.delete(record.folderName.toLowerCase());
      reservedLowerNames.set(lowerTarget, record.project.id);
      logInfo(
        `[Projects] Naming migration: renamed folder "${record.folderName}" → "${safeFolderName}" ` +
          `for project "${name}" (id=${record.project.id})`
      );
    } catch (error) {
      assertOwnerActive();
      logError(`[Projects] Naming migration failed for project id="${record.project.id}"`, error);
    } finally {
      for (const lease of fileWriteLeases) {
        releaseProjectFileWrite(lease);
      }
    }
  }

  assertOwnerActive();
  if (renamed > 0) {
    logInfo(`[Projects] Naming migration complete: ${renamed} folder(s) renamed`);
  }
}

/**
 * Runs settings migration and then the name-based folder migration for one lifecycle.
 *
 * @param app - App that owns the target Vault
 * @param owner - Active Projects state lifecycle owner
 */
export async function ensureProjectsMigratedIfNeeded(
  app: App,
  owner: ProjectStateOwner
): Promise<void> {
  const assertOwnerActive = createProjectStateOwnerAssertion(owner);
  assertOwnerActive();

  const legacyProjects = getSettings().projectList || [];
  if (legacyProjects.length > 0) {
    await migrateProjectsFromSettingsToVault(app, owner);
    assertOwnerActive();
  }

  // Reason: run naming migration after data.json migration to rename id-based folders
  // to name-based folders. This also handles pre-existing projects from before the
  // naming convention change. Runs before loadAllProjects() in initialization flow.
  assertOwnerActive();
  await migrateProjectFolderNames(app, owner);
  assertOwnerActive();
}
