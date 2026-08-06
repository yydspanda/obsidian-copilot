/** Vault source request exposed to Chat without Runtime or Queue authority. */
export interface KnowledgeChatCaptureRequest {
  sourcePath: string;
}

/** Truthful durable receipt returned before the next generation performs ingest. */
export interface KnowledgeChatCaptureReceipt {
  status: "registered" | "already_registered";
  bundleId: string;
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
  | "registration_failed";

/** Sanitized capture failure that retains no source path or persisted content. */
export class KnowledgeChatCaptureError extends Error {
  /** Creates one stable capture failure. */
  constructor(public readonly code: KnowledgeChatCaptureErrorCode) {
    super("The Vault file could not be added to Knowledge");
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
}

/** Exact source suffixes enabled for the first Chat capture production slice. */
export const KNOWLEDGE_CHAT_CAPTURE_SUFFIXES = Object.freeze([".markdown", ".md", ".txt"]);

/**
 * Checks whether a Vault path is eligible for the H.3a intent chooser.
 *
 * Production registration repeats parser and suffix authorization; this helper
 * only controls which existing Chat drops are diverted into an explicit choice.
 *
 * @param sourcePath - Vault-relative candidate path
 * @returns Whether the path has one supported text suffix
 */
export function isKnowledgeChatCapturePath(sourcePath: string): boolean {
  const key = sourcePath.replace(/\\/g, "/").normalize("NFC").toLowerCase().normalize("NFC");
  return KNOWLEDGE_CHAT_CAPTURE_SUFFIXES.some((suffix) => key.endsWith(suffix));
}
