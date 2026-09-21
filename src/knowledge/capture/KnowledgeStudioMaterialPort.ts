/** One current Vault file available to the explicit Studio material chooser. */
export interface KnowledgeStudioMaterialChoice {
  readonly path: string;
  readonly size: number;
}

/** Read-only chooser data bound privately to one released production generation. */
export interface KnowledgeStudioMaterialSession {
  readonly bundleId: string;
  readonly sourceRoot: string;
  readonly choices: readonly KnowledgeStudioMaterialChoice[];
}

/** Exact path and custody mode shown before the user authorizes one addition. */
export interface KnowledgeStudioMaterialSelection {
  readonly bundleId: string;
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly mode: "register" | "snapshot";
}

/** Successful registration/copy receipt, not evidence of compilation or Wiki Apply. */
export interface KnowledgeStudioMaterialReceipt extends KnowledgeStudioMaterialSelection {
  readonly status: "added" | "already_added";
}

/** Fixed diagnostic categories that retain no rejected path, bytes, or error text. */
export type KnowledgeStudioMaterialErrorCode =
  | "unavailable"
  | "stale_selection"
  | "source_changed"
  | "source_too_large"
  | "source_not_allowed"
  | "conflict"
  | "add_failed";

/** Safe error boundary for explicit Studio material selection and addition. */
export class KnowledgeStudioMaterialError extends Error {
  constructor(public readonly code: KnowledgeStudioMaterialErrorCode) {
    super("The Knowledge material could not be added");
    this.name = "KnowledgeStudioMaterialError";
  }
}

/** Generation-bound, single-material capability without Queue or Wiki authority. */
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
