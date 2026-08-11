import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import { sha256 } from "@/utils/hash";

/** Current deterministic format for one user-reviewed Chat knowledge draft. */
export const KNOWLEDGE_CHAT_DRAFT_CAPTURE_VERSION = 1 as const;

/** Bounded user-authored fields accepted before a Chat draft is persisted. */
export const KNOWLEDGE_CHAT_DRAFT_LIMITS = Object.freeze({
  maxTitleCharacters: 200,
  maxBodyCharacters: 1_000_000,
  maxSourceBytes: 2_000_000,
});

/** Editable fields submitted from one completed assistant response. */
export interface KnowledgeChatDraftRequest {
  readonly title: string;
  readonly body: string;
  readonly reviewConfirmed: true;
}

/** Internal deterministic Markdown capture created from an exact UI request. */
export interface KnowledgeChatDraftCapture {
  readonly version: typeof KNOWLEDGE_CHAT_DRAFT_CAPTURE_VERSION;
  readonly title: string;
  readonly body: string;
  readonly sourceContent: string;
  readonly sourceContentHash: string;
  readonly captureDigest: string;
}

/** Sanitized validation failure that does not retain draft content. */
export class KnowledgeChatDraftCaptureError extends TypeError {
  /** Creates one value-free capture error. */
  constructor() {
    super("The Knowledge draft is invalid");
    this.name = "KnowledgeChatDraftCaptureError";
  }
}

/** Reads one enumerable own data property without evaluating an accessor. */
function readDataProperty(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Expected an enumerable data property");
    }
    return descriptor.value;
  } catch {
    throw new KnowledgeChatDraftCaptureError();
  }
}

/** Captures one exact plain request record before any text processing. */
function captureRequest(value: unknown): Readonly<KnowledgeChatDraftRequest> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("Expected a record");
    }
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      keys.length !== 3 ||
      keys.some((key) => typeof key !== "string") ||
      !(keys as string[]).includes("title") ||
      !(keys as string[]).includes("body") ||
      !(keys as string[]).includes("reviewConfirmed")
    ) {
      throw new TypeError("Expected an exact record");
    }
    const title = readDataProperty(value, "title");
    const body = readDataProperty(value, "body");
    const reviewConfirmed = readDataProperty(value, "reviewConfirmed");
    if (typeof title !== "string" || typeof body !== "string" || reviewConfirmed !== true) {
      throw new TypeError("Expected text fields");
    }
    return Object.freeze({ title, body, reviewConfirmed });
  } catch (error) {
    if (error instanceof KnowledgeChatDraftCaptureError) throw error;
    throw new KnowledgeChatDraftCaptureError();
  }
}

/** Validates one bounded single-line title without silently normalizing it. */
function captureTitle(value: string): string {
  if (
    value.length === 0 ||
    value.length > KNOWLEDGE_CHAT_DRAFT_LIMITS.maxTitleCharacters ||
    value.trim() !== value ||
    /[\r\n\0]/u.test(value)
  ) {
    throw new KnowledgeChatDraftCaptureError();
  }
  return value;
}

/** Validates one non-empty Markdown body while preserving the user's exact text. */
function captureBody(value: string): string {
  if (
    value.length === 0 ||
    value.length > KNOWLEDGE_CHAT_DRAFT_LIMITS.maxBodyCharacters ||
    value.trim().length === 0 ||
    value.includes("\0")
  ) {
    throw new KnowledgeChatDraftCaptureError();
  }
  return value;
}

/** Renders the exact Markdown source that will enter the normal Knowledge pipeline. */
function renderSource(title: string, body: string): string {
  return `# ${title}\n\n${body}${body.endsWith("\n") ? "" : "\n"}`;
}

/**
 * Creates one deterministic, bounded Markdown capture from user-reviewed Chat text.
 *
 * The result contains no inferred citation, hidden prompt, conversation history, or
 * Vault path. The production coordinator chooses the only authorized destination.
 */
export function createKnowledgeChatDraftCapture(value: unknown): KnowledgeChatDraftCapture {
  const request = captureRequest(value);
  const title = captureTitle(request.title);
  const body = captureBody(request.body);
  const sourceContent = renderSource(title, body);
  const encodedSource = new TextEncoder().encode(sourceContent);
  if (
    encodedSource.byteLength > KNOWLEDGE_CHAT_DRAFT_LIMITS.maxSourceBytes ||
    new TextDecoder("utf-8", { fatal: true }).decode(encodedSource) !== sourceContent
  ) {
    throw new KnowledgeChatDraftCaptureError();
  }
  const sourceContentHash = createSourceContentHash(sourceContent);
  const captureDigest = sha256(
    `obsidian-copilot-knowledge-chat-draft-v1\n${title.length}:${title}\n${body.length}:${body}`
  );
  return Object.freeze({
    version: KNOWLEDGE_CHAT_DRAFT_CAPTURE_VERSION,
    title,
    body,
    sourceContent,
    sourceContentHash,
    captureDigest,
  });
}
