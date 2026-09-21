import type { KnowledgeChatCapturePort } from "@/knowledge/capture/KnowledgeChatCapturePort";
import {
  isKnowledgeChatCapturePath,
  KnowledgeChatCaptureError,
} from "@/knowledge/capture/KnowledgeChatCapturePort";
import type { KnowledgeFolderImportPort } from "@/knowledge/capture/KnowledgeFolderImportPort";
import {
  KnowledgeStudioMaterialError,
  type KnowledgeStudioMaterialPort,
  type KnowledgeStudioMaterialReceipt,
  type KnowledgeStudioMaterialSelection,
  type KnowledgeStudioMaterialSession,
} from "@/knowledge/capture/KnowledgeStudioMaterialPort";
import { isPathWithinRoot, parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { TFile, type DataAdapter, type Vault } from "obsidian";

const MAX_SNAPSHOT_BYTES = 8_388_608;
const MAX_DESTINATION_PATH_LENGTH = 240;
const EMPTY_CHOICES = Object.freeze([]);

/** Exact released-generation delegates; callers must not supply redirecting stable ports. */
export interface KnowledgeStudioMaterialGeneration {
  readonly bundleId: string;
  readonly sourceRoot: string;
  readonly excludedRoots: readonly string[];
  readonly excludedPaths: readonly string[];
  readonly capture: Pick<KnowledgeChatCapturePort, "addVaultSource">;
  readonly folderImport: KnowledgeFolderImportPort;
  assertCurrent(): void;
}

/** Read-only original-file access and the current explicit registration authority. */
export interface KnowledgeStudioMaterialCoordinatorInput {
  vault: Pick<Vault, "getFiles" | "getAbstractFileByPath" | "readBinary"> & {
    adapter: Pick<DataAdapter, "stat">;
  };
  getCurrentGeneration(): KnowledgeStudioMaterialGeneration | undefined;
}

interface CapturedMaterial {
  generation: KnowledgeStudioMaterialGeneration;
  file: TFile;
  path: string;
  size: number;
  mtime: number;
  ctime: number;
}

/**
 * Authorizes one explicit Studio file choice without changing source roots or originals.
 * Registration and exclusive snapshot publication remain owned by existing capture adapters.
 */
export class KnowledgeStudioMaterialCoordinator implements KnowledgeStudioMaterialPort {
  private readonly sessions = new WeakMap<object, KnowledgeStudioMaterialGeneration>();
  private readonly selections = new WeakMap<object, CapturedMaterial>();
  private readonly pendingSelections = new WeakSet<object>();

  constructor(private readonly input: KnowledgeStudioMaterialCoordinatorInput) {}

  /**
   * Lists supported file identities without reading their contents or starting ingest.
   * @param bundleId - Bundle currently displayed by the Studio session
   */
  prepare(bundleId: string): Readonly<KnowledgeStudioMaterialSession> | null {
    // Inventory is read-only and must belong to the Bundle the user is actually viewing.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    try {
      const generation = this.input.getCurrentGeneration();
      if (!generation || generation.bundleId !== bundleId) return null;
      this.assertCurrent(generation);
      const choices = this.input.vault
        .getFiles()
        .filter((file) => this.isAllowed(file, generation))
        .map((file) => Object.freeze({ path: file.path, size: file.stat.size }))
        .sort((left, right) => left.path.localeCompare(right.path));
      this.assertCurrent(generation);
      const session = Object.freeze({
        bundleId,
        sourceRoot: generation.sourceRoot,
        choices: choices.length > 0 ? Object.freeze(choices) : EMPTY_CHOICES,
      });
      this.sessions.set(session, generation);
      return session;
    } catch {
      return null;
    }
  }

  /**
   * Binds the exact displayed mode and destination before any user confirmation.
   * @param session - Original chooser capability, not a reconstructed object
   * @param sourcePath - One path from that chooser's read-only inventory
   */
  select(
    session: Readonly<KnowledgeStudioMaterialSession>,
    sourcePath: string
  ): Readonly<KnowledgeStudioMaterialSelection> {
    const generation = this.sessions.get(session);
    if (!generation) throw new KnowledgeStudioMaterialError("stale_selection");
    this.assertCurrent(generation);
    if (!session.choices.some((choice) => choice.path === sourcePath)) {
      throw new KnowledgeStudioMaterialError("source_not_allowed");
    }
    const file = this.findFile(sourcePath);
    if (!(file instanceof TFile) || file.path !== sourcePath || !this.isAllowed(file, generation)) {
      throw new KnowledgeStudioMaterialError("source_changed");
    }
    const mode = isPathWithinRoot(sourcePath, generation.sourceRoot) ? "register" : "snapshot";
    // Outside-root originals need an explicit bounded snapshot, never an implicit root grant.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    if (mode === "snapshot" && file.stat.size > MAX_SNAPSHOT_BYTES) {
      throw new KnowledgeStudioMaterialError("source_too_large");
    }
    const destinationPath =
      mode === "register" ? sourcePath : `${generation.sourceRoot}/Vault/${sourcePath}`;
    if (mode === "snapshot" && destinationPath.length > MAX_DESTINATION_PATH_LENGTH) {
      throw new KnowledgeStudioMaterialError("source_not_allowed");
    }
    const selection = Object.freeze({
      bundleId: generation.bundleId,
      sourcePath,
      destinationPath,
      mode,
    });
    this.selections.set(selection, {
      generation,
      file,
      path: file.path,
      size: file.stat.size,
      mtime: file.stat.mtime,
      ctime: file.stat.ctime,
    });
    return selection;
  }

  /**
   * Adds only a previously confirmed selection through its original generation.
   * @param selection - Opaque selection returned by this coordinator
   * @param signal - Cancellation owned by the initiating Studio view
   */
  async add(
    selection: Readonly<KnowledgeStudioMaterialSelection>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeStudioMaterialReceipt>> {
    if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
    const captured = this.selections.get(selection);
    if (!captured || this.pendingSelections.has(selection)) {
      throw new KnowledgeStudioMaterialError("stale_selection");
    }
    this.assertCurrent(captured.generation);
    this.assertUnchanged(captured);
    this.pendingSelections.add(selection);
    let readFailure: Error | undefined;
    try {
      let status: KnowledgeStudioMaterialReceipt["status"];
      if (selection.mode === "register") {
        const receipt = await captured.generation.capture.addVaultSource(
          { sourcePath: captured.path },
          signal
        );
        if (receipt.bundleId !== captured.generation.bundleId) {
          throw new KnowledgeStudioMaterialError("add_failed");
        }
        status = receipt.status === "registered" ? "added" : "already_added";
      } else {
        // Reuse exclusive folder publication and its exact metadata replay, not Vault.write.
        // https://github.com/yydspanda/obsidian-copilot/issues/13
        const receipt = await captured.generation.folderImport.importFolder(
          {
            files: [
              Object.freeze({
                webkitRelativePath: `Vault/${captured.path}`,
                size: captured.size,
                arrayBuffer: async () => {
                  try {
                    return await this.readSnapshot(captured, signal);
                  } catch (error) {
                    readFailure =
                      error instanceof Error
                        ? error
                        : new KnowledgeStudioMaterialError("add_failed");
                    throw readFailure;
                  }
                },
              }),
            ],
          },
          signal
        );
        if (readFailure !== undefined) throw readFailure;
        if (receipt.conflictFiles > 0) throw new KnowledgeStudioMaterialError("conflict");
        if (
          receipt.bundleId !== captured.generation.bundleId ||
          receipt.status !== "completed" ||
          receipt.failedFiles > 0 ||
          receipt.importedFiles + receipt.reusedFiles !== 1
        ) {
          throw new KnowledgeStudioMaterialError("add_failed");
        }
        status = receipt.importedFiles === 1 ? "added" : "already_added";
      }
      // The write's own refresh can revoke the generation; a durable receipt still wins.
      // https://github.com/yydspanda/obsidian-copilot/issues/13
      return Object.freeze({ ...selection, status });
    } catch (error) {
      const failure = readFailure ?? error;
      if (failure instanceof KnowledgeStudioMaterialError) throw failure;
      if (signal.aborted || (failure instanceof Error && failure.name === "AbortError")) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      if (failure instanceof KnowledgeChatCaptureError && failure.code === "source_conflict") {
        throw new KnowledgeStudioMaterialError("conflict");
      }
      throw new KnowledgeStudioMaterialError("add_failed");
    } finally {
      this.pendingSelections.delete(selection);
    }
  }

  /** Reads only the confirmed original, bounded before allocation and re-proved afterward. */
  private async readSnapshot(
    captured: CapturedMaterial,
    signal: AbortSignal
  ): Promise<ArrayBuffer> {
    if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
    this.assertCurrent(captured.generation);
    this.assertUnchanged(captured);
    if (captured.size > MAX_SNAPSHOT_BYTES)
      throw new KnowledgeStudioMaterialError("source_too_large");
    await this.assertSnapshotStat(captured, signal);
    const bytes = await this.input.vault.readBinary(captured.file);
    if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
    this.assertCurrent(captured.generation);
    this.assertUnchanged(captured);
    if (bytes.byteLength !== captured.size)
      throw new KnowledgeStudioMaterialError("source_changed");
    await this.assertSnapshotStat(captured, signal);
    return bytes;
  }

  /** Fresh adapter metadata closes the delayed-Vault-event gap around bounded reads. */
  private async assertSnapshotStat(captured: CapturedMaterial, signal: AbortSignal): Promise<void> {
    // TFile.stat can lag external edits; reject oversized files using current metadata too.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    const stat = await this.input.vault.adapter.stat(captured.path);
    if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
    this.assertCurrent(captured.generation);
    this.assertUnchanged(captured);
    if (stat?.type === "file" && stat.size > MAX_SNAPSHOT_BYTES) {
      throw new KnowledgeStudioMaterialError("source_too_large");
    }
    if (
      !stat ||
      stat.type !== "file" ||
      stat.size !== captured.size ||
      stat.mtime !== captured.mtime ||
      stat.ctime !== captured.ctime
    ) {
      throw new KnowledgeStudioMaterialError("source_changed");
    }
  }

  /** File replacement or edits invalidate consent to the previously displayed material. */
  private assertUnchanged(captured: CapturedMaterial): void {
    // Recheck both identity and stat around reading so a stale path cannot supply new bytes.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    const current = this.findFile(captured.path);
    if (
      current !== captured.file ||
      captured.file.path !== captured.path ||
      captured.file.stat.size !== captured.size ||
      captured.file.stat.mtime !== captured.mtime ||
      captured.file.stat.ctime !== captured.ctime
    ) {
      throw new KnowledgeStudioMaterialError("source_changed");
    }
  }

  /** Keeps unexpected Vault lookup errors from exposing private path details. */
  private findFile(path: string): ReturnType<Vault["getAbstractFileByPath"]> {
    // Unknown adapter errors are not safe UI diagnostics.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    try {
      return this.input.vault.getAbstractFileByPath(path);
    } catch {
      throw new KnowledgeStudioMaterialError("add_failed");
    }
  }

  /** Rejects stale chooser authority instead of redirecting it to a replacement Bundle. */
  private assertCurrent(generation: KnowledgeStudioMaterialGeneration): void {
    // A picker can remain open while configuration changes; its old selection is not new consent.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    try {
      if (this.input.getCurrentGeneration() !== generation) throw new Error();
      generation.assertCurrent();
    } catch {
      throw new KnowledgeStudioMaterialError("stale_selection");
    }
  }

  /** Filters generated/configuration boundaries before a path becomes selectable. */
  private isAllowed(file: TFile, generation: KnowledgeStudioMaterialGeneration): boolean {
    // Generated output and configuration are not raw materials for this explicit chooser.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    const parsed = parseVaultPath(file.path);
    return (
      parsed.ok &&
      parsed.path === file.path &&
      isKnowledgeChatCapturePath(file.path) &&
      Number.isSafeInteger(file.stat.size) &&
      file.stat.size >= 0 &&
      !generation.excludedRoots.some((root) => isPathWithinRoot(file.path, root)) &&
      !generation.excludedPaths.some(
        (path) => toWindowsPathKey(path) === toWindowsPathKey(file.path)
      )
    );
  }
}
