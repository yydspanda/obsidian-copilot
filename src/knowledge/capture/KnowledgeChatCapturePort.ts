import type { KnowledgeChatDraftRequest } from "@/knowledge/capture/KnowledgeChatDraftCapture";

export interface KnowledgeChatCaptureRequest {
  sourcePath: string;
}

export interface KnowledgeChatCaptureReceipt {
  status: "registered" | "already_registered";
  bundleId: string;
}

export interface KnowledgeChatDraftReceipt {
  status: "registered" | "already_registered";
  bundleId: string;
  sourcePath: string;
}

export interface KnowledgeChatDraftSession {
  readonly bundleId: string;
  readonly sourceRoot: string;
}

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

export class KnowledgeChatCaptureError extends Error {
  constructor(public readonly code: KnowledgeChatCaptureErrorCode) {
    super("The Knowledge capture operation could not be completed");
    this.name = "KnowledgeChatCaptureError";
  }
}

export interface KnowledgeChatCapturePort {
  addVaultSource(
    request: Readonly<KnowledgeChatCaptureRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeChatCaptureReceipt>;

  prepareKnowledgeDraft(): Readonly<KnowledgeChatDraftSession> | null;

  createKnowledgeDraft(
    session: Readonly<KnowledgeChatDraftSession>,
    request: Readonly<KnowledgeChatDraftRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeChatDraftReceipt>;
}

export const KNOWLEDGE_CHAT_CAPTURE_SUFFIXES = Object.freeze([".markdown", ".md", ".pdf", ".txt"]);

export function isKnowledgeChatCapturePath(sourcePath: string): boolean {
  const key = sourcePath.replace(/\\/g, "/").normalize("NFC").toLowerCase().normalize("NFC");
  return KNOWLEDGE_CHAT_CAPTURE_SUFFIXES.some((suffix) => key.endsWith(suffix));
}
