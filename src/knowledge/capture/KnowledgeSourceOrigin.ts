import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { JsonValue, SourceManifestEntry } from "@/knowledge/model/types";
import { sha256 } from "@/utils/hash";

export const KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY =
  "obsidianCopilotKnowledgeSourceOrigin" as const;

export type KnowledgeSourceCompileOperation = "ingest" | "query_writeback";

export type KnowledgeSourceOriginOperation =
  | "chat_add_to_knowledge"
  | "chat_knowledge_draft"
  | "folder_import"
  | "query_writeback";

export interface KnowledgeChatSourceOrigin {
  version: 1;
  operation: "chat_add_to_knowledge";
}

export interface KnowledgeFolderImportSourceOrigin {
  version: 1;
  operation: "folder_import";
}

export interface KnowledgeChatDraftSourceOrigin {
  version: 1;
  operation: "chat_knowledge_draft";
  captureDigest: string;
  captureContentHash: string;
}

export interface KnowledgeQueryWritebackSourceOrigin {
  version: 1;
  operation: "query_writeback";
  captureDigest: string;
  captureContentHash: string;
}

export type KnowledgeSourceOrigin =
  | KnowledgeChatSourceOrigin
  | KnowledgeChatDraftSourceOrigin
  | KnowledgeFolderImportSourceOrigin
  | KnowledgeQueryWritebackSourceOrigin;

export interface KnowledgeQueryWritebackSourceOriginInput {
  captureDigest: string;
  captureContentHash: string;
}

export type KnowledgeChatDraftSourceOriginInput = KnowledgeQueryWritebackSourceOriginInput;

export type KnowledgeSourceCompileAuthority =
  | Readonly<{ operation: "ingest" }>
  | Readonly<{
      operation: "query_writeback";
      sourceOriginDigest: string;
      expectedSourceContentHash: string;
    }>;

export class KnowledgeSourceOriginValidationError extends TypeError {
  constructor() {
    super("The knowledge source origin extension is invalid");
    this.name = "KnowledgeSourceOriginValidationError";
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function readDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new KnowledgeSourceOriginValidationError();
  }
  return descriptor.value;
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  let actual: PropertyKey[];
  try {
    actual = Reflect.ownKeys(value);
  } catch {
    throw new KnowledgeSourceOriginValidationError();
  }
  const expectedKeys = [...expected].sort();
  if (
    actual.length !== expectedKeys.length ||
    actual.some((key) => typeof key !== "string") ||
    (actual as string[]).sort().some((key, index) => key !== expectedKeys[index])
  ) {
    throw new KnowledgeSourceOriginValidationError();
  }
}

export function parseKnowledgeSourceOrigin(value: unknown): KnowledgeSourceOrigin {
  if (!isPlainRecord(value)) throw new KnowledgeSourceOriginValidationError();
  const operation = readDataProperty(value, "operation");
  if (operation === "chat_add_to_knowledge" || operation === "folder_import") {
    assertExactKeys(value, ["version", "operation"]);
    if (readDataProperty(value, "version") !== 1) {
      throw new KnowledgeSourceOriginValidationError();
    }
    return Object.freeze({ version: 1, operation });
  }
  if (operation === "chat_knowledge_draft" || operation === "query_writeback") {
    assertExactKeys(value, ["version", "operation", "captureDigest", "captureContentHash"]);
    const captureDigest = readDataProperty(value, "captureDigest");
    const captureContentHash = readDataProperty(value, "captureContentHash");
    if (
      readDataProperty(value, "version") !== 1 ||
      typeof captureDigest !== "string" ||
      !SHA256_PATTERN.test(captureDigest) ||
      typeof captureContentHash !== "string" ||
      !SHA256_PATTERN.test(captureContentHash)
    ) {
      throw new KnowledgeSourceOriginValidationError();
    }
    return Object.freeze({ version: 1, operation, captureDigest, captureContentHash });
  }
  throw new KnowledgeSourceOriginValidationError();
}

export function createKnowledgeSourceOriginDigest(origin: KnowledgeSourceOrigin): string {
  const parsed = parseKnowledgeSourceOrigin(origin);
  return sha256(`knowledge-source-origin-v1\n${canonicalizeJson(parsed as unknown as JsonValue)}`);
}

export function deriveKnowledgeSourceCompileAuthority(
  entry: Readonly<SourceManifestEntry>
): KnowledgeSourceCompileAuthority {
  const value = entry.extensions?.[KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY];
  if (value === undefined) return Object.freeze({ operation: "ingest" });
  const origin = parseKnowledgeSourceOrigin(value);
  if (
    origin.operation === "chat_add_to_knowledge" ||
    origin.operation === "chat_knowledge_draft" ||
    origin.operation === "folder_import"
  ) {
    return Object.freeze({ operation: "ingest" });
  }
  if (entry.custody !== "managed_copy") {
    throw new KnowledgeSourceOriginValidationError();
  }
  return Object.freeze({
    operation: "query_writeback",
    sourceOriginDigest: createKnowledgeSourceOriginDigest(origin),
    expectedSourceContentHash: origin.captureContentHash,
  });
}

export function createKnowledgeSourceOriginExtensions(
  operation: "chat_add_to_knowledge" | "folder_import"
): Record<string, JsonValue>;
export function createKnowledgeSourceOriginExtensions(
  operation: "query_writeback",
  input: Readonly<KnowledgeQueryWritebackSourceOriginInput>
): Record<string, JsonValue>;
export function createKnowledgeSourceOriginExtensions(
  operation: "chat_knowledge_draft",
  input: Readonly<KnowledgeChatDraftSourceOriginInput>
): Record<string, JsonValue>;
export function createKnowledgeSourceOriginExtensions(
  operation: KnowledgeSourceOriginOperation,
  input?: Readonly<KnowledgeQueryWritebackSourceOriginInput>
): Record<string, JsonValue> {
  const origin: KnowledgeSourceOrigin =
    operation === "chat_add_to_knowledge" || operation === "folder_import"
      ? { version: 1, operation }
      : {
          version: 1,
          operation,
          captureDigest: input?.captureDigest ?? "",
          captureContentHash: input?.captureContentHash ?? "",
        };
  const parsed = parseKnowledgeSourceOrigin(origin);
  return { [KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY]: parsed as unknown as JsonValue };
}
