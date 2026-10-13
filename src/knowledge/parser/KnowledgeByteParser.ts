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

export const MAX_KNOWLEDGE_SOURCE_BYTES = 8_388_608;

export const MAX_KNOWLEDGE_PARSED_PDF_PAGES = 2_048;

export interface KnowledgeByteParserRequest {
  sourceId: string;
  sourcePath: string;
  sourceContentHash: string;
  bytes: Uint8Array;
}

export interface KnowledgeParsedSource {
  artifact: TextArtifactObservation | PdfArtifactObservation;
}

export interface KnowledgeByteParser {
  getProfile(): KnowledgeSourceParserProfile;

  parse(request: Readonly<KnowledgeByteParserRequest>, signal: AbortSignal): Promise<unknown>;
}

export class KnowledgeByteParserInputError extends TypeError {
  constructor() {
    super("The knowledge byte parser input is invalid");
    this.name = "KnowledgeByteParserInputError";
  }
}

export class KnowledgeByteParserOutputError extends TypeError {
  constructor() {
    super("The knowledge byte parser returned an invalid artifact");
    this.name = "KnowledgeByteParserOutputError";
  }
}

export function createKnowledgeParserAbortError(): Error {
  const error = new Error("The knowledge byte parser operation was aborted");
  error.name = "AbortError";
  return error;
}

export function throwIfKnowledgeParserAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createKnowledgeParserAbortError();
  }
}

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

function isCanonicalText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

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
