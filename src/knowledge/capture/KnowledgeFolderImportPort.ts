export type KnowledgeFolderImportFile = Pick<File, "webkitRelativePath" | "size" | "arrayBuffer">;

export interface KnowledgeFolderImportRequest {
  files: readonly KnowledgeFolderImportFile[];
}

export interface KnowledgeFolderImportReceipt {
  status: "completed" | "partial";
  bundleId: string;
  discoveredFiles: number;
  eligibleFiles: number;
  importedFiles: number;
  reusedFiles: number;
  skippedFiles: number;
  conflictFiles: number;
  failedFiles: number;
  importedBytes: number;
}

export type KnowledgeFolderImportErrorCode =
  | "unavailable"
  | "ambiguous_bundle"
  | "ambiguous_source_root"
  | "invalid_selection"
  | "selection_too_large"
  | "unsupported_runtime"
  | "import_failed";

export class KnowledgeFolderImportError extends Error {
  constructor(public readonly code: KnowledgeFolderImportErrorCode) {
    super("The selected folder could not be imported into Knowledge");
    this.name = "KnowledgeFolderImportError";
  }
}

export interface KnowledgeFolderImportPort {
  importFolder(
    request: Readonly<KnowledgeFolderImportRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeFolderImportReceipt>;
}

export const KNOWLEDGE_FOLDER_IMPORT_SUFFIXES = Object.freeze([".markdown", ".md", ".pdf", ".txt"]);
