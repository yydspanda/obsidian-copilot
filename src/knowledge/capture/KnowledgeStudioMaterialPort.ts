export interface KnowledgeStudioMaterialChoice {
  readonly path: string;
  readonly size: number;
}

export interface KnowledgeStudioMaterialSession {
  readonly bundleId: string;
  readonly sourceRoot: string;
  readonly choices: readonly KnowledgeStudioMaterialChoice[];
}

export interface KnowledgeStudioMaterialSelection {
  readonly bundleId: string;
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly mode: "register" | "snapshot";
}

export interface KnowledgeStudioMaterialReceipt extends KnowledgeStudioMaterialSelection {
  readonly status: "added" | "already_added";
}

export type KnowledgeStudioMaterialErrorCode =
  | "unavailable"
  | "stale_selection"
  | "source_changed"
  | "source_too_large"
  | "source_not_allowed"
  | "conflict"
  | "add_failed";

export class KnowledgeStudioMaterialError extends Error {
  constructor(public readonly code: KnowledgeStudioMaterialErrorCode) {
    super("The Knowledge material could not be added");
    this.name = "KnowledgeStudioMaterialError";
  }
}

export interface KnowledgeStudioMaterialPort {
  prepare(bundleId: string): Readonly<KnowledgeStudioMaterialSession> | null;
  select(
    session: Readonly<KnowledgeStudioMaterialSession>,
    sourcePath: string
  ): Readonly<KnowledgeStudioMaterialSelection>;
  add(
    selection: Readonly<KnowledgeStudioMaterialSelection>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeStudioMaterialReceipt>>;
}
