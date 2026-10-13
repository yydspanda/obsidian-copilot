import type { KnowledgeSourceParserProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  type KnowledgeByteParser,
  type KnowledgeByteParserRequest,
  throwIfKnowledgeParserAborted,
  verifyKnowledgeByteParserRequest,
} from "@/knowledge/parser/KnowledgeByteParser";

export const UTF8_TEXT_KNOWLEDGE_PARSER_VERSION = "utf8-text-v1";

export interface Utf8TextKnowledgeByteParserOptions {
  id: string;
  pathSuffixes: readonly string[];
  maxBytes: number;
  maxCharacters: number;
}

export type Utf8TextKnowledgeParserErrorCode =
  | "source_too_large"
  | "invalid_utf8"
  | "utf8_round_trip_failed"
  | "decoded_text_too_large"
  | "decoded_text_empty";

export class Utf8TextKnowledgeParserError extends Error {
  constructor(public readonly code: Utf8TextKnowledgeParserErrorCode) {
    super("The knowledge source is not valid bounded UTF-8 text");
    this.name = "Utf8TextKnowledgeParserError";
  }
}

function requirePositiveLimit(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function requireIdentifier(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError("Parser id must be canonical non-empty text");
  }
  return value;
}

function normalizeSuffix(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.trim() !== value ||
    !value.startsWith(".") ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new TypeError("Parser path suffix is invalid");
  }
  return toWindowsPathKey(value);
}

function haveEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export class Utf8TextKnowledgeByteParser implements KnowledgeByteParser {
  private readonly profile: KnowledgeSourceParserProfile;
  private readonly maxBytes: number;
  private readonly maxCharacters: number;

  constructor(options: Utf8TextKnowledgeByteParserOptions) {
    const id = requireIdentifier(options.id);
    const pathSuffixes = options.pathSuffixes.map(normalizeSuffix).sort();
    if (pathSuffixes.length === 0 || new Set(pathSuffixes).size !== pathSuffixes.length) {
      throw new TypeError("Parser path suffixes must be unique and non-empty");
    }
    this.maxBytes = requirePositiveLimit(options.maxBytes, "maxBytes");
    this.maxCharacters = requirePositiveLimit(options.maxCharacters, "maxCharacters");
    this.profile = Object.freeze({
      id,
      version: UTF8_TEXT_KNOWLEDGE_PARSER_VERSION,
      pathSuffixes: Object.freeze(pathSuffixes),
      configuration: Object.freeze({
        artifactKind: "text",
        encoding: "utf-8",
        fatalDecoding: true,
        preserveBom: true,
        preserveLineEndings: true,
        requireByteRoundTrip: true,
        maxBytes: this.maxBytes,
        maxCharacters: this.maxCharacters,
      }),
    });
    Object.freeze(this);
  }

  getProfile(): KnowledgeSourceParserProfile {
    return this.profile;
  }

  async parse(
    requestValue: Readonly<KnowledgeByteParserRequest>,
    signal: AbortSignal
  ): Promise<unknown> {
    throwIfKnowledgeParserAborted(signal);
    const request = verifyKnowledgeByteParserRequest(requestValue);
    if (request.bytes.length > this.maxBytes) {
      throw new Utf8TextKnowledgeParserError("source_too_large");
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(request.bytes);
    } catch {
      throw new Utf8TextKnowledgeParserError("invalid_utf8");
    }
    throwIfKnowledgeParserAborted(signal);

    const encoded = new TextEncoder().encode(text);
    if (!haveEqualBytes(encoded, request.bytes)) {
      throw new Utf8TextKnowledgeParserError("utf8_round_trip_failed");
    }
    if (text.length > this.maxCharacters) {
      throw new Utf8TextKnowledgeParserError("decoded_text_too_large");
    }
    if (text.trim().length === 0) {
      throw new Utf8TextKnowledgeParserError("decoded_text_empty");
    }

    return Object.freeze({
      artifact: Object.freeze({
        kind: "text" as const,
        sourceId: request.sourceId,
        artifactId: "primary",
        artifactContentHash: createFileContentHash(text),
        text,
      }),
    });
  }
}

Object.freeze(Utf8TextKnowledgeByteParser.prototype);
Object.freeze(Utf8TextKnowledgeByteParser);
