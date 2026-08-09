import { apiVersion, loadPdfJs } from "obsidian";

import type { KnowledgeSourceParserProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import type { PdfPageObservation } from "@/knowledge/model/locatorMaterialValidation";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  MAX_KNOWLEDGE_PARSED_PDF_PAGES,
  type KnowledgeByteParser,
  type KnowledgeByteParserRequest,
  throwIfKnowledgeParserAborted,
  verifyKnowledgeByteParserRequest,
} from "@/knowledge/parser/KnowledgeByteParser";

/** Current exact Obsidian PDF.js page-text behavior contract. */
export const PDF_PAGE_KNOWLEDGE_PARSER_VERSION = "obsidian-pdfjs-page-text-v1";

/** Explicit resource and routing configuration for the built-in PDF parser. */
export interface PdfPageKnowledgeByteParserOptions {
  id: string;
  pathSuffixes: readonly string[];
  maxBytes: number;
  maxPages: number;
  maxCharacters: number;
  extractPages?: PdfPageTextExtractor;
}

/** Exact copied-byte request exposed to the narrow PDF page-text extractor. */
export interface PdfPageTextExtractionRequest {
  bytes: Uint8Array;
  maxPages: number;
  maxCharacters: number;
}

/** Path-incapable PDF page-text extraction boundary. */
export type PdfPageTextExtractor = (
  request: Readonly<PdfPageTextExtractionRequest>,
  signal: AbortSignal
) => Promise<unknown>;

/** Stable, value-free content failures emitted by the built-in PDF parser. */
export type PdfPageKnowledgeParserErrorCode =
  | "source_too_large"
  | "invalid_pdf"
  | "page_limit_exceeded"
  | "extracted_text_too_large"
  | "extracted_text_empty";

/** Reports rejected PDF material without retaining bytes, text, or paths. */
export class PdfPageKnowledgeParserError extends Error {
  /** Creates one sanitized parser-content failure. */
  constructor(public readonly code: PdfPageKnowledgeParserErrorCode) {
    super("The knowledge source is not a valid bounded PDF");
    this.name = "PdfPageKnowledgeParserError";
  }
}

interface PdfJsLoadingTask {
  promise: PromiseLike<unknown>;
  destroy: () => unknown;
}

interface PdfJsDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<unknown>;
}

interface PdfJsPage {
  getTextContent: () => Promise<unknown>;
  cleanup?: () => unknown;
}

/** Checks a positive safe parser resource bound. */
function requirePositiveLimit(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

/** Checks one stable parser identifier without normalizing it. */
function requireIdentifier(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError("Parser id must be canonical non-empty text");
  }
  return value;
}

/** Checks and returns the exact host API identity used by the parser profile. */
function requireHostApiVersion(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError("Obsidian API version must be canonical non-empty text");
  }
  return value;
}

/** Validates and Windows-normalizes one generic parser-owned suffix. */
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

/** Checks the narrow loading-task surface returned by PDF.js. */
function isPdfJsLoadingTask(value: unknown): value is PdfJsLoadingTask {
  return (
    typeof value === "object" &&
    value !== null &&
    "promise" in value &&
    typeof value.promise === "object" &&
    value.promise !== null &&
    "then" in value.promise &&
    typeof value.promise.then === "function" &&
    "destroy" in value &&
    typeof value.destroy === "function"
  );
}

/** Checks the narrow document surface used for bounded page traversal. */
function isPdfJsDocument(value: unknown): value is PdfJsDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    "numPages" in value &&
    typeof value.numPages === "number" &&
    Number.isSafeInteger(value.numPages) &&
    value.numPages > 0 &&
    "getPage" in value &&
    typeof value.getPage === "function"
  );
}

/** Checks the narrow page surface used for text extraction. */
function isPdfJsPage(value: unknown): value is PdfJsPage {
  return (
    typeof value === "object" &&
    value !== null &&
    "getTextContent" in value &&
    typeof value.getTextContent === "function"
  );
}

/** Reads PDF.js text-content items in their exact returned array order. */
function extractOrderedPageText(value: unknown, remainingCharacters: number): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("items" in value) ||
    !Array.isArray(value.items)
  ) {
    throw new PdfPageKnowledgeParserError("invalid_pdf");
  }
  const items = value.items as unknown[];
  let text = "";
  for (const item of items) {
    if (typeof item !== "object" || item === null || !("str" in item)) {
      continue;
    }
    if (typeof item.str !== "string") {
      throw new PdfPageKnowledgeParserError("invalid_pdf");
    }
    const hasEndOfLine = "hasEOL" in item && item.hasEOL === true;
    const separator = text.length > 0 && !text.endsWith("\n") && item.str.length > 0 ? " " : "";
    const lineEnding = hasEndOfLine ? "\n" : "";
    const addedLength = separator.length + item.str.length + lineEnding.length;
    if (addedLength > remainingCharacters - text.length) {
      throw new PdfPageKnowledgeParserError("extracted_text_too_large");
    }
    text += `${separator}${item.str}${lineEnding}`;
  }
  return text;
}

/** Destroys one PDF loading task while containing cleanup-only failures. */
async function destroyPdfJsLoadingTask(task: PdfJsLoadingTask): Promise<void> {
  try {
    await task.destroy();
  } catch {
    // Cleanup is best-effort; the parser's primary success/failure remains authoritative.
  }
}

/** Releases page-local PDF.js caches while containing cleanup-only failures. */
function cleanupPdfJsPage(page: PdfJsPage): void {
  try {
    page.cleanup?.();
  } catch {
    // Page cleanup must not replace the parser's primary result.
  }
}

/**
 * Extracts deterministic 1-based page text through Obsidian's public PDF.js loader.
 *
 * The caller must supply a parser-owned byte copy. PDF.js is explicitly denied
 * dynamic code evaluation, and its loading task is destroyed on every outcome.
 */
export const extractObsidianPdfPageText: PdfPageTextExtractor = async (
  request,
  signal
): Promise<unknown> => {
  throwIfKnowledgeParserAborted(signal);
  let loadingTask: PdfJsLoadingTask | undefined;
  let destroyPromise: Promise<void> | undefined;
  try {
    const pdfJs: unknown = await loadPdfJs();
    throwIfKnowledgeParserAborted(signal);
    if (
      typeof pdfJs !== "object" ||
      pdfJs === null ||
      !("getDocument" in pdfJs) ||
      typeof pdfJs.getDocument !== "function"
    ) {
      throw new PdfPageKnowledgeParserError("invalid_pdf");
    }
    const taskValue: unknown = pdfJs.getDocument({
      data: request.bytes,
      isEvalSupported: false,
    });
    if (!isPdfJsLoadingTask(taskValue)) {
      throw new PdfPageKnowledgeParserError("invalid_pdf");
    }
    loadingTask = taskValue;
    const startDestroy = (): Promise<void> => {
      destroyPromise ??= destroyPdfJsLoadingTask(taskValue);
      return destroyPromise;
    };
    const destroyOnAbort = (): void => {
      void startDestroy();
    };
    signal.addEventListener("abort", destroyOnAbort, { once: true });
    try {
      if (signal.aborted) {
        void startDestroy();
        throwIfKnowledgeParserAborted(signal);
      }
      const documentValue = await taskValue.promise;
      throwIfKnowledgeParserAborted(signal);
      if (!isPdfJsDocument(documentValue)) {
        throw new PdfPageKnowledgeParserError("invalid_pdf");
      }
      if (documentValue.numPages > request.maxPages) {
        throw new PdfPageKnowledgeParserError("page_limit_exceeded");
      }

      const pages: PdfPageObservation[] = [];
      let totalCharacters = 0;
      for (let pageNumber = 1; pageNumber <= documentValue.numPages; pageNumber += 1) {
        throwIfKnowledgeParserAborted(signal);
        const pageValue = await documentValue.getPage(pageNumber);
        throwIfKnowledgeParserAborted(signal);
        if (!isPdfJsPage(pageValue)) {
          throw new PdfPageKnowledgeParserError("invalid_pdf");
        }
        try {
          const textContent = await pageValue.getTextContent();
          throwIfKnowledgeParserAborted(signal);
          const text = extractOrderedPageText(textContent, request.maxCharacters - totalCharacters);
          totalCharacters += text.length;
          pages.push(Object.freeze({ page: pageNumber, text }));
        } finally {
          cleanupPdfJsPage(pageValue);
        }
      }
      return Object.freeze(pages);
    } finally {
      signal.removeEventListener("abort", destroyOnAbort);
    }
  } catch (error) {
    throwIfKnowledgeParserAborted(signal);
    if (error instanceof PdfPageKnowledgeParserError) {
      throw error;
    }
    throw new PdfPageKnowledgeParserError("invalid_pdf");
  } finally {
    if (loadingTask) {
      destroyPromise ??= destroyPdfJsLoadingTask(loadingTask);
      await destroyPromise;
    }
  }
};

/** Reads and freezes a narrow extractor success into dense 1-based pages. */
function verifyExtractedPages(
  value: unknown,
  maxPages: number,
  maxCharacters: number
): readonly PdfPageObservation[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxPages) {
    throw new PdfPageKnowledgeParserError("invalid_pdf");
  }
  const pages: PdfPageObservation[] = [];
  let totalCharacters = 0;
  let hasNonBlankPage = false;
  for (let index = 0; index < value.length; index += 1) {
    const page = value[index] as unknown;
    if (
      typeof page !== "object" ||
      page === null ||
      Array.isArray(page) ||
      Object.getPrototypeOf(page) !== Object.prototype ||
      Reflect.ownKeys(page).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(page, "page") ||
      !Object.prototype.hasOwnProperty.call(page, "text")
    ) {
      throw new PdfPageKnowledgeParserError("invalid_pdf");
    }
    const pageDescriptor = Object.getOwnPropertyDescriptor(page, "page");
    const textDescriptor = Object.getOwnPropertyDescriptor(page, "text");
    if (
      !pageDescriptor ||
      !("value" in pageDescriptor) ||
      !pageDescriptor.enumerable ||
      pageDescriptor.value !== index + 1 ||
      !textDescriptor ||
      !("value" in textDescriptor) ||
      !textDescriptor.enumerable ||
      typeof textDescriptor.value !== "string"
    ) {
      throw new PdfPageKnowledgeParserError("invalid_pdf");
    }
    const text = textDescriptor.value;
    if (text.length > maxCharacters - totalCharacters) {
      throw new PdfPageKnowledgeParserError("extracted_text_too_large");
    }
    totalCharacters += text.length;
    hasNonBlankPage ||= text.trim().length > 0;
    pages.push(Object.freeze({ page: index + 1, text }));
  }
  if (!hasNonBlankPage) {
    throw new PdfPageKnowledgeParserError("extracted_text_empty");
  }
  return Object.freeze(pages);
}

/**
 * Deterministic PDF parser that consumes only copied, already-observed bytes.
 *
 * The emitted artifact hash always identifies the original raw PDF bytes so a
 * future page citation can be revoked when the Vault file drifts.
 */
export class PdfPageKnowledgeByteParser implements KnowledgeByteParser {
  private readonly profile: KnowledgeSourceParserProfile;
  private readonly maxBytes: number;
  private readonly maxPages: number;
  private readonly maxCharacters: number;
  private readonly extractPages: PdfPageTextExtractor;

  /** Creates one versioned parser capability and its matching fingerprint profile. */
  constructor(options: PdfPageKnowledgeByteParserOptions) {
    const id = requireIdentifier(options.id);
    const pathSuffixes = options.pathSuffixes.map(normalizeSuffix).sort();
    if (pathSuffixes.length === 0 || new Set(pathSuffixes).size !== pathSuffixes.length) {
      throw new TypeError("Parser path suffixes must be unique and non-empty");
    }
    this.maxBytes = requirePositiveLimit(options.maxBytes, "maxBytes");
    this.maxPages = requirePositiveLimit(options.maxPages, "maxPages");
    if (this.maxPages > MAX_KNOWLEDGE_PARSED_PDF_PAGES) {
      throw new TypeError("maxPages exceeds the verified PDF page ceiling");
    }
    this.maxCharacters = requirePositiveLimit(options.maxCharacters, "maxCharacters");
    this.extractPages = options.extractPages ?? extractObsidianPdfPageText;
    if (typeof this.extractPages !== "function") {
      throw new TypeError("extractPages must be a function");
    }
    this.profile = Object.freeze({
      id,
      version: PDF_PAGE_KNOWLEDGE_PARSER_VERSION,
      pathSuffixes: Object.freeze(pathSuffixes),
      configuration: Object.freeze({
        artifactKind: "pdf",
        loader: "obsidian.loadPdfJs",
        hostApiVersion: requireHostApiVersion(apiVersion),
        byteOwnership: "parser-copy",
        isEvalSupported: false,
        pageNumbering: "1-based-contiguous",
        textItemOrder: "pdfjs-text-content-array-order",
        itemSeparator: "space",
        endOfLineSeparator: "lf",
        maxBytes: this.maxBytes,
        maxPages: this.maxPages,
        maxCharacters: this.maxCharacters,
      }),
    });
    Object.freeze(this);
  }

  /** Returns the immutable behavior profile used by the watch-plan builder. */
  getProfile(): KnowledgeSourceParserProfile {
    return this.profile;
  }

  /** Extracts bounded page text from a copy of the exact request bytes. */
  async parse(
    requestValue: Readonly<KnowledgeByteParserRequest>,
    signal: AbortSignal
  ): Promise<unknown> {
    throwIfKnowledgeParserAborted(signal);
    const request = verifyKnowledgeByteParserRequest(requestValue);
    if (request.bytes.length > this.maxBytes) {
      throw new PdfPageKnowledgeParserError("source_too_large");
    }
    const parserOwnedBytes = request.bytes.slice();
    let extractedValue: unknown;
    try {
      extractedValue = await this.extractPages(
        Object.freeze({
          bytes: parserOwnedBytes,
          maxPages: this.maxPages,
          maxCharacters: this.maxCharacters,
        }),
        signal
      );
    } catch (error) {
      throwIfKnowledgeParserAborted(signal);
      if (error instanceof PdfPageKnowledgeParserError) {
        throw error;
      }
      throw new PdfPageKnowledgeParserError("invalid_pdf");
    }
    throwIfKnowledgeParserAborted(signal);
    if (createSourceContentHash(request.bytes) !== request.sourceContentHash) {
      throw new PdfPageKnowledgeParserError("invalid_pdf");
    }
    const pages = verifyExtractedPages(extractedValue, this.maxPages, this.maxCharacters);
    return Object.freeze({
      artifact: Object.freeze({
        kind: "pdf" as const,
        sourceId: request.sourceId,
        artifactId: "primary",
        artifactContentHash: request.sourceContentHash,
        pages,
      }),
    });
  }
}

Object.freeze(PdfPageKnowledgeByteParser.prototype);
Object.freeze(PdfPageKnowledgeByteParser);
