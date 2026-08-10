/** Browser-selected folder payload exposed without an external absolute path. */
export interface KnowledgeFolderImportRequest {
  files: readonly File[];
}

/** Aggregate, path-free receipt returned after one bounded folder import pass. */
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

/** Stable, value-free folder import failure categories safe to render. */
export type KnowledgeFolderImportErrorCode =
  | "unavailable"
  | "ambiguous_bundle"
  | "ambiguous_source_root"
  | "invalid_selection"
  | "selection_too_large"
  | "unsupported_runtime"
  | "import_failed";

/** Sanitized folder import failure that retains no file names, paths, or bytes. */
export class KnowledgeFolderImportError extends Error {
  /** Creates one stable folder import failure. */
  constructor(public readonly code: KnowledgeFolderImportErrorCode) {
    super("The selected folder could not be imported into Knowledge");
    this.name = "KnowledgeFolderImportError";
  }
}

/** Narrow stable command surface retained by Knowledge Studio across generations. */
export interface KnowledgeFolderImportPort {
  /** Copies and registers supported files from one explicit browser folder selection. */
  importFolder(
    request: Readonly<KnowledgeFolderImportRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeFolderImportReceipt>;
}

/** Exact source suffixes enabled for the first folder import production slice. */
export const KNOWLEDGE_FOLDER_IMPORT_SUFFIXES = Object.freeze([".markdown", ".md", ".pdf", ".txt"]);
