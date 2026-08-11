import type { KnowledgeChatDraftRequest } from "@/knowledge/capture/KnowledgeChatDraftCapture";

/** Vault source request exposed to Chat without Runtime or Queue authority. */
export interface KnowledgeChatCaptureRequest {
  sourcePath: string;
}

/** Truthful durable receipt returned before the next generation performs ingest. */
export interface KnowledgeChatCaptureReceipt {
  status: "registered" | "already_registered";
  bundleId: string;
}

/** Truthful durable result for one user-reviewed Chat draft registration. */
export interface KnowledgeChatDraftReceipt {
  status: "registered" | "already_registered";
  bundleId: string;
  sourcePath: string;
}

/** Frozen destination capability shown before one Chat draft is edited. */
export interface KnowledgeChatDraftSession {
  readonly bundleId: string;
  readonly sourceRoot: string;
}

/** Stable, value-free Chat capture failure categories safe to render. */
export type KnowledgeChatCaptureErrorCode =
  | "unavailable"
  | "ambiguous_bundle"
  | "ambiguous_source_root"
  | "unsupported_source_type"
  | "source_outside_root"
  | "source_missing"
  | "source_conflict"
  | "draft_invalid"
  | "draft_conflict"
  | "draft_persistence_failed"
  | "registration_failed";

/** Sanitized capture failure that retains no source path or persisted content. */
export class KnowledgeChatCaptureError extends Error {
  /** Creates one stable capture failure. */
  constructor(public readonly code: KnowledgeChatCaptureErrorCode) {
    super("The Knowledge capture operation could not be completed");
    this.name = "KnowledgeChatCaptureError";
  }
}

/** Narrow stable command surface consumed by Chat. */
export interface KnowledgeChatCapturePort {
  /** Registers one explicit Vault file choice without adding it to Chat context. */
  addVaultSource(
    request: Readonly<KnowledgeChatCaptureRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeChatCaptureReceipt>;

  /** Captures the exact current Bundle/root or reports that draft creation is unavailable. */
  prepareKnowledgeDraft(): Readonly<KnowledgeChatDraftSession> | null;

  /** Persists one edited Chat response as a registered Source, never as direct Wiki output. */
  createKnowledgeDraft(
    session: Readonly<KnowledgeChatDraftSession>,
    request: Readonly<KnowledgeChatDraftRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeChatDraftReceipt>;
}

/** Exact source suffixes enabled for the current Chat capture production slice. */
export const KNOWLEDGE_CHAT_CAPTURE_SUFFIXES = Object.freeze([".markdown", ".md", ".pdf", ".txt"]);

/**
 * Checks whether a Vault path is eligible for the H.3a intent chooser.
 *
 * Production registration repeats parser and suffix authorization; this helper
 * only controls which existing Chat drops are diverted into an explicit choice.
 *
 * @param sourcePath - Vault-relative candidate path
 * @returns Whether the path has one supported production parser suffix
 */
export function isKnowledgeChatCapturePath(sourcePath: string): boolean {
  const key = sourcePath.replace(/\\/g, "/").normalize("NFC").toLowerCase().normalize("NFC");
  return KNOWLEDGE_CHAT_CAPTURE_SUFFIXES.some((suffix) => key.endsWith(suffix));
}
