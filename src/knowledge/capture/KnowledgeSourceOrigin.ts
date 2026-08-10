import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { JsonValue, SourceManifestEntry } from "@/knowledge/model/types";
import { sha256 } from "@/utils/hash";

/** Reserved Manifest extension that records why a durable source was registered. */
export const KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY =
  "obsidianCopilotKnowledgeSourceOrigin" as const;

/** Source-backed compiler operations authorized by an exact Manifest entry. */
export type KnowledgeSourceCompileOperation = "ingest" | "query_writeback";

/** Operations allowed to create a first-party durable source registration. */
export type KnowledgeSourceOriginOperation =
  | "chat_add_to_knowledge"
  | "folder_import"
  | "query_writeback";

/** Registration provenance for a user-managed source selected from Chat. */
export interface KnowledgeChatSourceOrigin {
  version: 1;
  operation: "chat_add_to_knowledge";
}

/** Registration provenance for a managed copy selected through folder import. */
export interface KnowledgeFolderImportSourceOrigin {
  version: 1;
  operation: "folder_import";
}

/** Immutable capture identity required to authorize a query-writeback compile. */
export interface KnowledgeQueryWritebackSourceOrigin {
  version: 1;
  operation: "query_writeback";
  captureDigest: string;
  captureContentHash: string;
}

/** Versioned, data-only source provenance retained in the Manifest extension bag. */
export type KnowledgeSourceOrigin =
  | KnowledgeChatSourceOrigin
  | KnowledgeFolderImportSourceOrigin
  | KnowledgeQueryWritebackSourceOrigin;

/** Query-writeback identity supplied only after deterministic capture creation. */
export interface KnowledgeQueryWritebackSourceOriginInput {
  captureDigest: string;
  captureContentHash: string;
}

/** Exact compile authority derived from one strict Manifest source entry. */
export type KnowledgeSourceCompileAuthority =
  | Readonly<{ operation: "ingest" }>
  | Readonly<{
      operation: "query_writeback";
      sourceOriginDigest: string;
      expectedSourceContentHash: string;
    }>;

/** Sanitized failure for a malformed or unauthorized first-party origin extension. */
export class KnowledgeSourceOriginValidationError extends TypeError {
  /** Creates one stable failure without retaining extension values. */
  constructor() {
    super("The knowledge source origin extension is invalid");
    this.name = "KnowledgeSourceOriginValidationError";
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/** Reports whether a value is a plain data record. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** Reads an enumerable own data property without invoking an accessor. */
function readDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new KnowledgeSourceOriginValidationError();
  }
  return descriptor.value;
}

/** Requires one exact enumerable string-key set. */
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

/** Parses the reserved extension without accepting unknown fields or accessors. */
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
  if (operation === "query_writeback") {
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

/** Computes the canonical identity of one strict first-party source origin. */
export function createKnowledgeSourceOriginDigest(origin: KnowledgeSourceOrigin): string {
  const parsed = parseKnowledgeSourceOrigin(origin);
  return sha256(`knowledge-source-origin-v1\n${canonicalizeJson(parsed as unknown as JsonValue)}`);
}

/**
 * Derives compiler operation authority only from one exact Manifest entry.
 *
 * Sources without the reserved extension, including legacy sources, remain
 * ordinary ingest sources. Query writeback additionally requires managed-copy
 * custody so edited user files cannot acquire writeback authority.
 */
export function deriveKnowledgeSourceCompileAuthority(
  entry: Readonly<SourceManifestEntry>
): KnowledgeSourceCompileAuthority {
  const value = entry.extensions?.[KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY];
  if (value === undefined) return Object.freeze({ operation: "ingest" });
  const origin = parseKnowledgeSourceOrigin(value);
  if (origin.operation === "chat_add_to_knowledge" || origin.operation === "folder_import") {
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

/**
 * Creates the strict Manifest extension used by all first-party source capture paths.
 *
 * Keeping this helper below Chat and Query orchestration lets both features share
 * one durable provenance vocabulary without granting either UI access to Runtime.
 *
 * @param operation - First-party operation that created the source registration
 * @returns Detached JSON-safe Manifest extension bag
 */
export function createKnowledgeSourceOriginExtensions(
  operation: "chat_add_to_knowledge" | "folder_import"
): Record<string, JsonValue>;
export function createKnowledgeSourceOriginExtensions(
  operation: "query_writeback",
  input: Readonly<KnowledgeQueryWritebackSourceOriginInput>
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
