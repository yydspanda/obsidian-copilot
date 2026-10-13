import { ProjectConfig } from "@/aiParams";
import { logError, logInfo, logWarn } from "@/logger";
import { COPILOT_PROJECT_ID, PROJECTS_UNSUPPORTED_FOLDER_NAME } from "@/projects/constants";
import { reconcileLegacyAgentsResidue } from "@/projects/legacyAgentsResidue";
import {
  deriveProjectFolderName,
  getProjectAnchorFromConfigPath,
  sanitizeVaultPathSegment,
} from "@/projects/projectPaths";
import {
  createProjectStateOwnerAssertion,
  ensureProjectFrontmatter,
  getProjectConfigFilePath,
  getProjectsFolder,
  readFrontmatterFieldFromFile,
  scanAllProjectConfigFiles,
  writeProjectFrontmatter,
} from "@/projects/projectUtils";
import {
  acquireProjectFileWrite,
  ProjectFileWriteLease,
  ProjectStateOwner,
  releaseProjectFileWrite,
} from "@/projects/state";
import { getSettings, updateSetting } from "@/settings/model";
import type { StartupMigrationItem } from "@/services/startupMigration";
import { ensureFolderExists, stripFrontmatter } from "@/utils";
import { App, normalizePath, parseYaml, TFile, TFolder, Vault } from "obsidian";
import { trashFile } from "@/utils/vaultAdapterUtils";

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

async function saveFailedProjectToUnsupported(
  vault: Vault,
  project: ProjectConfig,
  reason: string,
  projectsFolder: string,
  assertOwnerActive: () => void
): Promise<boolean> {
  try {
    const unsupportedFolder = normalizePath(
      `${projectsFolder}/${PROJECTS_UNSUPPORTED_FOLDER_NAME}`
    );
    assertOwnerActive();
    await ensureFolderExists(vault, unsupportedFolder, assertOwnerActive);
    assertOwnerActive();

    const safeId = sanitizeVaultPathSegment(project.id || "unknown") || "unknown";
    const baseName = `Project Migration Failed - ${safeId}`;
    let filePath = `${unsupportedFolder}/${baseName}.md`;
    let suffix = 2;

    while (true) {
      assertOwnerActive();
      const backupExists = await vault.adapter.exists(filePath);
      assertOwnerActive();
      if (!backupExists) break;

      if (suffix === 2) {
        try {
          assertOwnerActive();
          const existingContent = await vault.adapter.read(filePath);
          assertOwnerActive();
          const jsonMatch = existingContent.match(/```json\s*\n([\s\S]*?)\n```/);
          if (jsonMatch) {
            const backedUpProject = JSON.parse(jsonMatch[1]);
            // Reason: compare full JSON to detect same-id but different-content duplicates.
            // An existing complete copy also permits clearing the legacy entry on retry.
            // https://github.com/yydspanda/obsidian-copilot/issues/10
            if (JSON.stringify(backedUpProject) === JSON.stringify(project)) return true;
          }
        } catch (error) {
          assertOwnerActive();
          logWarn(`[Projects] Could not compare with existing backup "${filePath}"`, error);
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
    // Never discard the only original merely because a backup write resolved.
    // https://github.com/yydspanda/obsidian-copilot/issues/10
    const savedContent = await vault.adapter.read(filePath);
    assertOwnerActive();
    return savedContent === content;
  } catch (backupError) {
    assertOwnerActive();

    logError(
      `[Projects] Failed to save unsupported backup for project id=${project.id || "unknown"}`,
      backupError
    );
    return false;
  }
}

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
    assertOwnerActive();
    logError(`[Projects] Migration rollback failed for ${filePath}`, rollbackError);
  }
}

async function writeProjectToVaultFile(
  app: App,
  owner: ProjectStateOwner,
  project: ProjectConfig,
  folderName: string,
  projectsFolder: string,
  assertOwnerActive: () => void
): Promise<TFile> {
  const vault = app.vault;
  assertOwnerActive();
  await ensureFolderExists(vault, projectsFolder, assertOwnerActive);
  assertOwnerActive();
  await ensureFolderExists(vault, `${projectsFolder}/${folderName}`, assertOwnerActive);
  assertOwnerActive();

  const filePath = getProjectConfigFilePath(folderName, projectsFolder);

  const folderPath = `${projectsFolder}/${folderName}`;

  const fileWriteLease = acquireProjectFileWrite(owner, filePath);
  if (!fileWriteLease) {
    throw new Error("Projects lifecycle ended before migration write");
  }
  try {
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

async function verifyMigratedContent(
  vault: Vault,
  fileOrPath: TFile | string,
  originalSystemPrompt: string,
  assertOwnerActive: () => void
): Promise<boolean> {
  try {
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

function getMigrationFolderName(projectId: string, projectName?: string): string {
  return deriveProjectFolderName(projectId, projectName);
}

export async function migrateProjectsFromSettingsToVault(
  app: App,
  owner: ProjectStateOwner
): Promise<StartupMigrationItem | null> {
  const assertOwnerActive = createProjectStateOwnerAssertion(owner);
  assertOwnerActive();

  const passProjectsFolder = getProjectsFolder();
  const vault = app.vault;
  const settings = getSettings();
  const legacyProjects = settings.projectList || [];

  if (legacyProjects.length === 0) {
    assertOwnerActive();
    logInfo("[Projects] No legacy projects to migrate");
    return null;
  }

  assertOwnerActive();
  logInfo(`[Projects] Migrating ${legacyProjects.length} legacy projects to vault files...`);

  const migratedEntries: ProjectConfig[] = [];
  const retainedEntries: ProjectConfig[] = [];
  const seenIds = new Set<string>();
  const seenFolderNames = new Map<string, string>();

  async function backUpOrRetain(project: ProjectConfig, reason: string): Promise<void> {
    const backedUp = await saveFailedProjectToUnsupported(
      vault,
      project,
      reason,
      passProjectsFolder,
      assertOwnerActive
    );
    // Storage failure must not erase the only recoverable project configuration.
    // https://github.com/yydspanda/obsidian-copilot/issues/10
    if (!backedUp) retainedEntries.push(project);
  }

  for (const project of legacyProjects) {
    assertOwnerActive();
    const id = (project.id || "").trim();

    if (!id) {
      logWarn("[Projects] Skip migrating project with empty id");
      await backUpOrRetain(project, "empty project id");
      assertOwnerActive();
      continue;
    }

    if (seenIds.has(id)) {
      logWarn(`[Projects] Skip migrating duplicate project id: ${id}`);
      await backUpOrRetain(project, `duplicate project id: ${id}`);
      assertOwnerActive();
      continue;
    }
    seenIds.add(id);

    const folderName = getMigrationFolderName(id, project.name);

    const folderKey = folderName.toLowerCase();
    const firstIdForFolder = seenFolderNames.get(folderKey);
    if (firstIdForFolder) {
      logWarn(
        `[Projects] Skip migrating project id="${id}": folder name "${folderName}" ` +
          `collides with id="${firstIdForFolder}"`
      );
      await backUpOrRetain(
        project,
        `folder name collision: "${folderName}" already used by id="${firstIdForFolder}"`
      );
      assertOwnerActive();
      continue;
    }
    seenFolderNames.set(folderKey, id);
    const filePath = getProjectConfigFilePath(folderName, passProjectsFolder);

    assertOwnerActive();
    const existingFile = vault.getAbstractFileByPath(filePath);
    let fileExistsOnDisk = existingFile instanceof TFile;
    if (!fileExistsOnDisk) {
      assertOwnerActive();
      fileExistsOnDisk = await vault.adapter.exists(filePath);
      assertOwnerActive();
    }
    if (fileExistsOnDisk) {
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

      if (existingId === id) {
        const verified = await verifyMigratedContent(
          vault,
          existingFile instanceof TFile ? existingFile : filePath,
          project.systemPrompt || "",
          assertOwnerActive
        );
        assertOwnerActive();
        if (verified) {
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
          migratedEntries.push(project);
          continue;
        }

        logWarn(`[Projects] Migration verify failed on existing file for id=${id} at ${filePath}`);
        await backUpOrRetain(
          project,
          `existing file content mismatch at ${filePath} (delete/rename the file and re-run migration)`
        );
        assertOwnerActive();
        continue;
      }

      logWarn(
        `[Projects] Migration conflict: ${filePath} exists with id="${existingId}" but expected "${id}"`
      );
      await backUpOrRetain(
        project,
        `target file exists at ${filePath} with mismatched id="${existingId}"`
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
        passProjectsFolder,
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
        const folderPath = `${passProjectsFolder}/${folderName}`;
        await rollbackCreatedFile(app, file.path, folderPath, assertOwnerActive);
        assertOwnerActive();
        await backUpOrRetain(project, "content verification mismatch");
        assertOwnerActive();
      } else {
        migratedEntries.push(project);
      }
    } catch (error) {
      assertOwnerActive();
      const msg = error instanceof Error ? error.message : String(error);
      logError(`[Projects] Failed to migrate project id=${id}`, error);
      await backUpOrRetain(project, msg);
      assertOwnerActive();
    }
  }

  // Verified targets and recovery copies replace legacy settings; unprotected
  // entries must stay available for a later retry rather than being lost.
  // https://github.com/yydspanda/obsidian-copilot/issues/10
  assertOwnerActive();
  updateSetting("projectList", retainedEntries);
  assertOwnerActive();

  const successCount = migratedEntries.length;
  const failedCount = legacyProjects.length - successCount;
  const projectsFolder = passProjectsFolder;
  const unsupportedFolder = normalizePath(
    `${passProjectsFolder}/${PROJECTS_UNSUPPORTED_FOLDER_NAME}`
  );
  const recoveryDetails: string[] = [];
  // Only direct the user to recovery copies that were actually verified.
  // https://github.com/yydspanda/obsidian-copilot/issues/10
  if (failedCount > retainedEntries.length) {
    recoveryDetails.push(`Recover backed-up projects from ${unsupportedFolder}.`);
  }
  // A failed backup leaves the legacy entry intact, not a promised recovery file.
  // https://github.com/yydspanda/obsidian-copilot/issues/10
  if (retainedEntries.length > 0) {
    recoveryDetails.push(
      `${retainedEntries.length} project(s) could not be backed up and remain in legacy settings for retry.`
    );
  }

  assertOwnerActive();
  if (failedCount === 0) {
    logInfo(
      `[Projects] Migration succeeded: all ${successCount} project(s) migrated to vault files`
    );
    return {
      id: "projects",
      title: "Projects",
      status: "success",
      summary: `All ${successCount} project${successCount === 1 ? " was" : "s were"} migrated to note files.`,
      details: [`Stored in ${projectsFolder}.`],
    };
  } else if (successCount > 0) {
    logWarn(
      `[Projects] Migration partially succeeded: ${successCount} migrated, ${failedCount} failed`
    );
    return {
      id: "projects",
      title: "Projects",
      status: "action-required",
      summary: `${successCount} project${successCount === 1 ? " was" : "s were"} migrated; ${failedCount} could not be migrated.`,
      details: [`Migrated projects are in ${projectsFolder}.`, ...recoveryDetails],
    };
  } else {
    logWarn("[Projects] Migration failed: no projects were migrated");
    return {
      id: "projects",
      title: "Projects",
      status: "error",
      summary: "No projects could be migrated.",
      details: recoveryDetails,
    };
  }
}

async function migrateProjectFolderNames(app: App, owner: ProjectStateOwner): Promise<void> {
  const assertOwnerActive = createProjectStateOwnerAssertion(owner);
  assertOwnerActive();

  const vault = app.vault;
  const { records } = await scanAllProjectConfigFiles(app);
  assertOwnerActive();
  if (records.length === 0) return;

  let renamed = 0;
  const reservedLowerNames = new Map<string, string>();
  for (const r of records) {
    reservedLowerNames.set(r.folderName.toLowerCase(), r.project.id);
  }

  for (const record of records) {
    assertOwnerActive();
    const name = (record.project.name || "").trim();
    if (!name) continue;

    const expectedFolder = sanitizeVaultPathSegment(name);
    const safeFolderName =
      expectedFolder.toLowerCase() === PROJECTS_UNSUPPORTED_FOLDER_NAME
        ? `_${expectedFolder}`
        : expectedFolder;

    if (safeFolderName === record.folderName) continue;

    const { projectsRoot: recordProjectsRoot, projectFolderPath: oldFolderPath } =
      getProjectAnchorFromConfigPath(record.filePath);
    const newFolderPath = `${recordProjectsRoot}/${safeFolderName}`;
    const oldFilePath = record.filePath;
    const newFilePath = getProjectConfigFilePath(safeFolderName, recordProjectsRoot);

    const lowerTarget = safeFolderName.toLowerCase();
    const existingOwner = reservedLowerNames.get(lowerTarget);
    if (existingOwner && existingOwner !== record.project.id) {
      logWarn(
        `[Projects] Naming migration skip: folder "${safeFolderName}" collides (case-insensitive) ` +
          `with project id="${existingOwner}" for project id="${record.project.id}"`
      );
      continue;
    }

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
      assertOwnerActive();
      const oldFileWriteLease = acquireProjectFileWrite(owner, oldFilePath);
      const newFileWriteLease = acquireProjectFileWrite(owner, newFilePath);
      if (!oldFileWriteLease || !newFileWriteLease) {
        if (oldFileWriteLease) releaseProjectFileWrite(oldFileWriteLease);
        if (newFileWriteLease) releaseProjectFileWrite(newFileWriteLease);
        return;
      }
      fileWriteLeases.push(oldFileWriteLease, newFileWriteLease);

      const folderObj = vault.getAbstractFileByPath(oldFolderPath);
      assertOwnerActive();
      if (folderObj instanceof TFolder) {
        await vault.rename(folderObj, newFolderPath);
      } else {
        await vault.adapter.rename(oldFolderPath, newFolderPath);
      }
      assertOwnerActive();
      renamed++;
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

export async function ensureProjectsMigratedIfNeeded(
  app: App,
  owner: ProjectStateOwner
): Promise<StartupMigrationItem | null> {
  const assertOwnerActive = createProjectStateOwnerAssertion(owner);
  assertOwnerActive();
  const legacyProjects = getSettings().projectList || [];
  let migrationResult: StartupMigrationItem | null = null;
  if (legacyProjects.length > 0) {
    migrationResult = await migrateProjectsFromSettingsToVault(app, owner);
    assertOwnerActive();
  }

  assertOwnerActive();
  await reconcileLegacyAgentsResidue(app);
  assertOwnerActive();

  await migrateProjectFolderNames(app, owner);
  assertOwnerActive();
  return migrationResult;
}
