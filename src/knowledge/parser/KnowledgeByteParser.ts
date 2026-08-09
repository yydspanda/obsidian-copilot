import type { KnowledgeSourceParserProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import {
  createFileContentHash,
  createSourceContentHash,
  isExactUint8Array,
} from "@/knowledge/model/fingerprint";
import type {
  PdfArtifactObservation,
  TextArtifactObservation,
} from "@/knowledge/model/locatorMaterialValidation";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/** Hard parser-output ceiling aligned with the production evidence-item budget. */
export const MAX_KNOWLEDGE_PARSED_PDF_PAGES = 2_048;

/** Exact, already-observed bytes transferred to a path-incapable parser. */
export interface KnowledgeByteParserRequest {
  sourceId: string;
  sourcePath: string;
  sourceContentHash: string;
  bytes: Uint8Array;
}

/** Production parser projection: one deterministic, locator-addressable artifact. */
export interface KnowledgeParsedSource {
  artifact: TextArtifactObservation | PdfArtifactObservation;
}

/**
 * Parser capability whose API deliberately contains no App, Vault, TFile,
 * cache, settings, URL, or path-reader service.
 */
export interface KnowledgeByteParser {
  /** Returns the complete behavior profile used by pipeline fingerprinting. */
  getProfile(): KnowledgeSourceParserProfile;

  /** Parses only the exact bytes supplied by the execution boundary. */
  parse(request: Readonly<KnowledgeByteParserRequest>, signal: AbortSignal): Promise<unknown>;
}

/** Sanitized parser input failure that retains no source text or path. */
export class KnowledgeByteParserInputError extends TypeError {
  /** Creates one stable parser-input failure. */
  constructor() {
    super("The knowledge byte parser input is invalid");
    this.name = "KnowledgeByteParserInputError";
  }
}

/** Sanitized parser success-payload failure. */
export class KnowledgeByteParserOutputError extends TypeError {
  /** Creates one stable parser-output failure. */
  constructor() {
    super("The knowledge byte parser returned an invalid artifact");
    this.name = "KnowledgeByteParserOutputError";
  }
}

/** Creates a platform-compatible cancellation without retaining a signal reason. */
export function createKnowledgeParserAbortError(): Error {
  const error = new Error("The knowledge byte parser operation was aborted");
  error.name = "AbortError";
  return error;
}

/** Stops work at a parser boundary when its owning execution generation was cancelled. */
export function throwIfKnowledgeParserAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createKnowledgeParserAbortError();
  }
}

/**
 * Reads an exact plain record entirely through enumerable own data descriptors.
 *
 * @param value - Unknown runtime value
 * @param keys - Complete required field set
 * @returns Detached one-read snapshot, or undefined for any exotic shape
 */
function snapshotExactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const expected = [...keys].sort();
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expected.length ||
      ownKeys.some((key) => typeof key !== "string") ||
      (ownKeys as string[]).sort().some((key, index) => key !== expected[index])
    ) {
      return undefined;
    }
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return undefined;
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

/**
 * Reads one dense plain array without invoking accessors or inherited behavior.
 *
 * @param value - Unknown runtime array
 * @param maxItems - Largest accepted dense length
 * @returns Detached one-read item snapshot, or undefined for any exotic shape
 */
function snapshotExactArray(value: unknown, maxItems: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return undefined;
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maxItems
    ) {
      return undefined;
    }
    const length = lengthDescriptor.value as number;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1 || ownKeys[length] !== "length") {
      return undefined;
    }
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (ownKeys[index] !== key) {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return undefined;
      }
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

/** Checks one identifier without trimming or otherwise changing its identity. */
function isCanonicalText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

/**
 * Revalidates the exact byte request while preserving the reader-owned byte reference.
 *
 * @param value - Unknown execution-boundary request
 * @returns Frozen request whose bytes are the original exact Uint8Array
 */
export function verifyKnowledgeByteParserRequest(
  value: unknown
): Readonly<KnowledgeByteParserRequest> {
  const snapshot = snapshotExactRecord(value, [
    "sourceId",
    "sourcePath",
    "sourceContentHash",
    "bytes",
  ]);
  const parsedPath = snapshot ? parseVaultPath(snapshot.sourcePath) : undefined;
  if (
    !snapshot ||
    !isCanonicalText(snapshot.sourceId) ||
    !parsedPath?.ok ||
    parsedPath.path !== snapshot.sourcePath ||
    typeof snapshot.sourceContentHash !== "string" ||
    !SHA256_PATTERN.test(snapshot.sourceContentHash) ||
    !isExactUint8Array(snapshot.bytes) ||
    createSourceContentHash(snapshot.bytes) !== snapshot.sourceContentHash
  ) {
    throw new KnowledgeByteParserInputError();
  }
  return Object.freeze({
    sourceId: snapshot.sourceId,
    sourcePath: parsedPath.path,
    sourceContentHash: snapshot.sourceContentHash,
    bytes: snapshot.bytes,
  });
}

/**
 * Recomputes and freezes a parser's data-only success payload.
 *
 * @param value - Unknown parser success
 * @param request - Exact request the parser received
 * @param maxCharacters - Execution-owned decoded-text limit
 * @returns Detached immutable artifact
 */
export function verifyKnowledgeParsedSource(
  value: unknown,
  request: Readonly<KnowledgeByteParserRequest>,
  maxCharacters: number
): Readonly<KnowledgeParsedSource> {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    throw new TypeError("maxCharacters must be a positive safe integer");
  }
  const verifiedRequest = verifyKnowledgeByteParserRequest(request);
  const result = snapshotExactRecord(value, ["artifact"]);
  const textArtifact = result
    ? snapshotExactRecord(result.artifact, [
        "kind",
        "sourceId",
        "artifactId",
        "artifactContentHash",
        "text",
      ])
    : undefined;
  if (
    textArtifact &&
    textArtifact.kind === "text" &&
    textArtifact.sourceId === verifiedRequest.sourceId &&
    isCanonicalText(textArtifact.artifactId) &&
    typeof textArtifact.text === "string" &&
    textArtifact.text.trim().length > 0 &&
    textArtifact.text.length <= maxCharacters &&
    typeof textArtifact.artifactContentHash === "string" &&
    SHA256_PATTERN.test(textArtifact.artifactContentHash) &&
    createFileContentHash(textArtifact.text) === textArtifact.artifactContentHash
  ) {
    return Object.freeze({
      artifact: Object.freeze({
        kind: "text",
        sourceId: textArtifact.sourceId,
        artifactId: textArtifact.artifactId,
        artifactContentHash: textArtifact.artifactContentHash,
        text: textArtifact.text,
      }),
    });
  }

  const pdfArtifact = result
    ? snapshotExactRecord(result.artifact, [
        "kind",
        "sourceId",
        "artifactId",
        "artifactContentHash",
        "pages",
      ])
    : undefined;
  const pageValues = pdfArtifact
    ? snapshotExactArray(pdfArtifact.pages, MAX_KNOWLEDGE_PARSED_PDF_PAGES)
    : undefined;
  if (
    !pdfArtifact ||
    pdfArtifact.kind !== "pdf" ||
    pdfArtifact.sourceId !== verifiedRequest.sourceId ||
    !isCanonicalText(pdfArtifact.artifactId) ||
    pdfArtifact.artifactContentHash !== verifiedRequest.sourceContentHash ||
    !pageValues ||
    pageValues.length === 0
  ) {
    throw new KnowledgeByteParserOutputError();
  }

  const pages: PdfArtifactObservation["pages"][number][] = [];
  let totalCharacters = 0;
  let hasNonBlankPage = false;
  for (let index = 0; index < pageValues.length; index += 1) {
    const page = snapshotExactRecord(pageValues[index], ["page", "text"]);
    if (
      !page ||
      page.page !== index + 1 ||
      typeof page.text !== "string" ||
      page.text.length > maxCharacters - totalCharacters
    ) {
      throw new KnowledgeByteParserOutputError();
    }
    totalCharacters += page.text.length;
    hasNonBlankPage ||= page.text.trim().length > 0;
    pages.push(Object.freeze({ page: index + 1, text: page.text }));
  }
  if (!hasNonBlankPage) {
    throw new KnowledgeByteParserOutputError();
  }
  return Object.freeze({
    artifact: Object.freeze({
      kind: "pdf",
      sourceId: pdfArtifact.sourceId,
      artifactId: pdfArtifact.artifactId,
      artifactContentHash: pdfArtifact.artifactContentHash,
      pages: Object.freeze(pages),
    }),
  });
}
