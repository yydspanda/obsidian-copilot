import { loadPdfJs } from "obsidian";

import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import {
  verifyKnowledgeParsedSource,
  type KnowledgeByteParserRequest,
} from "@/knowledge/parser/KnowledgeByteParser";
import {
  extractObsidianPdfPageText,
  PDF_PAGE_KNOWLEDGE_PARSER_VERSION,
  PdfPageKnowledgeByteParser,
  type PdfPageKnowledgeByteParserOptions,
  type PdfPageTextExtractor,
} from "@/knowledge/parser/PdfPageKnowledgeByteParser";

const MAX_BYTES = 1_024;
const MAX_PAGES = 8;
const MAX_CHARACTERS = 1_024;

/** Creates one exact parser request over already observed PDF bytes. */
function createRequest(bytes = new TextEncoder().encode("%PDF-1.7\nexact bytes")) {
  return {
    sourceId: "source-pdf",
    sourcePath: "Sources/研究 paper.pdf",
    sourceContentHash: createSourceContentHash(bytes),
    bytes,
  } satisfies KnowledgeByteParserRequest;
}

/** Creates the built-in PDF parser with stable test limits. */
function createParser(
  extractPages: PdfPageTextExtractor,
  limits: Partial<
    Pick<PdfPageKnowledgeByteParserOptions, "maxBytes" | "maxPages" | "maxCharacters">
  > = {}
): PdfPageKnowledgeByteParser {
  return new PdfPageKnowledgeByteParser({
    id: "pdf-pages",
    pathSuffixes: [".PDF"],
    maxBytes: limits.maxBytes ?? MAX_BYTES,
    maxPages: limits.maxPages ?? MAX_PAGES,
    maxCharacters: limits.maxCharacters ?? MAX_CHARACTERS,
    extractPages,
  });
}

afterEach(() => {
  jest.mocked(loadPdfJs).mockReset();
});

describe("PdfPageKnowledgeByteParser", () => {
  it("copies exact bytes and publishes contiguous pages bound to the raw PDF hash", async () => {
    let extractorBytes: Uint8Array | undefined;
    const extractPages = jest.fn<
      ReturnType<PdfPageTextExtractor>,
      Parameters<PdfPageTextExtractor>
    >(async (request, _signal) => {
      extractorBytes = request.bytes;
      request.bytes[0] ^= 0xff;
      return [
        { page: 1, text: "第一页" },
        { page: 2, text: "" },
        { page: 3, text: "last page" },
      ];
    });
    const parser = createParser(extractPages);
    const request = createRequest();
    const originalBytes = [...request.bytes];

    const raw = await parser.parse(request, new AbortController().signal);
    const parsed = verifyKnowledgeParsedSource(raw, request, MAX_CHARACTERS);

    expect(extractorBytes).toBeDefined();
    expect(extractorBytes).not.toBe(request.bytes);
    expect([...request.bytes]).toEqual(originalBytes);
    expect(parsed.artifact).toEqual({
      kind: "pdf",
      sourceId: "source-pdf",
      artifactId: "primary",
      artifactContentHash: request.sourceContentHash,
      pages: [
        { page: 1, text: "第一页" },
        { page: 2, text: "" },
        { page: 3, text: "last page" },
      ],
    });
  });

  it("exposes the versioned immutable extraction and resource profile", () => {
    const parser = createParser(async () => [{ page: 1, text: "page" }], {
      maxBytes: 12,
      maxPages: 3,
      maxCharacters: 20,
    });

    expect(parser.getProfile()).toEqual({
      id: "pdf-pages",
      version: PDF_PAGE_KNOWLEDGE_PARSER_VERSION,
      pathSuffixes: [".pdf"],
      configuration: {
        artifactKind: "pdf",
        loader: "obsidian.loadPdfJs",
        hostApiVersion: "1.13.4-test",
        byteOwnership: "parser-copy",
        isEvalSupported: false,
        pageNumbering: "1-based-contiguous",
        textItemOrder: "pdfjs-text-content-array-order",
        itemSeparator: "space",
        endOfLineSeparator: "lf",
        maxBytes: 12,
        maxPages: 3,
        maxCharacters: 20,
      },
    });
    expect(Object.isFrozen(parser)).toBe(true);
    expect(Object.isFrozen(parser.getProfile())).toBe(true);
    expect(Object.isFrozen(parser.getProfile().configuration)).toBe(true);
  });

  it("enforces byte, page, text, and nonblank-material bounds", async () => {
    const request = createRequest();

    await expect(
      createParser(async () => [{ page: 1, text: "page" }], {
        maxBytes: request.bytes.length - 1,
      }).parse(request, new AbortController().signal)
    ).rejects.toMatchObject({ code: "source_too_large" });
    await expect(
      createParser(
        async () => [
          { page: 1, text: "one" },
          { page: 2, text: "two" },
        ],
        { maxPages: 1 }
      ).parse(request, new AbortController().signal)
    ).rejects.toMatchObject({ code: "invalid_pdf" });
    await expect(
      createParser(async () => [{ page: 1, text: "large" }], {
        maxCharacters: 4,
      }).parse(request, new AbortController().signal)
    ).rejects.toMatchObject({ code: "extracted_text_too_large" });
    await expect(
      createParser(async () => [
        { page: 1, text: " \r\n" },
        { page: 2, text: "" },
      ]).parse(request, new AbortController().signal)
    ).rejects.toMatchObject({ code: "extracted_text_empty" });
  });

  it("rejects noncontiguous and accessor-based extractor pages", async () => {
    const request = createRequest();
    await expect(
      createParser(async () => [
        { page: 1, text: "one" },
        { page: 3, text: "three" },
      ]).parse(request, new AbortController().signal)
    ).rejects.toMatchObject({ code: "invalid_pdf" });

    let getterCalls = 0;
    const accessorPage = Object.defineProperty({ page: 1 }, "text", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "must not be read";
      },
    });
    await expect(
      createParser(async () => [accessorPage]).parse(request, new AbortController().signal)
    ).rejects.toMatchObject({ code: "invalid_pdf" });
    expect(getterCalls).toBe(0);
  });

  it("honors cancellation and detects reader-owned byte drift", async () => {
    const request = createRequest();
    const controller = new AbortController();
    controller.abort(new Error("must not escape"));
    const extractPages = jest.fn<
      ReturnType<PdfPageTextExtractor>,
      Parameters<PdfPageTextExtractor>
    >(async (_request, _signal) => [{ page: 1, text: "page" }]);

    await expect(
      createParser(extractPages).parse(request, controller.signal)
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(extractPages).not.toHaveBeenCalled();

    await expect(
      createParser(async () => {
        request.bytes[0] ^= 0xff;
        return [{ page: 1, text: "page" }];
      }).parse(request, new AbortController().signal)
    ).rejects.toMatchObject({ code: "invalid_pdf" });
  });

  it("rejects all-empty pages from the default extractor and releases PDF.js resources", async () => {
    const cleanup = jest.fn();
    const getPage = jest.fn().mockImplementation(async () => ({
      getTextContent: jest.fn().mockResolvedValue({ items: [] }),
      cleanup,
    }));
    const destroy = jest.fn().mockResolvedValue(undefined);
    jest.mocked(loadPdfJs).mockResolvedValue({
      getDocument: jest.fn().mockReturnValue({
        promise: Promise.resolve({ numPages: 2, getPage }),
        destroy,
      }),
    });
    const parser = new PdfPageKnowledgeByteParser({
      id: "pdf-pages",
      pathSuffixes: [".pdf"],
      maxBytes: MAX_BYTES,
      maxPages: MAX_PAGES,
      maxCharacters: MAX_CHARACTERS,
    });

    await expect(parser.parse(createRequest(), new AbortController().signal)).rejects.toMatchObject(
      { code: "extracted_text_empty" }
    );
    expect(getPage).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("extractObsidianPdfPageText", () => {
  it("uses public loadPdfJs, disables eval, preserves item order, and destroys resources", async () => {
    const firstCleanup = jest.fn();
    const secondCleanup = jest.fn();
    const getPage = jest
      .fn()
      .mockResolvedValueOnce({
        getTextContent: jest.fn().mockResolvedValue({
          items: [
            { str: "Alpha", hasEOL: false },
            { str: "Beta", hasEOL: true },
            { type: "beginMarkedContent" },
            { str: "尾", hasEOL: false },
          ],
        }),
        cleanup: firstCleanup,
      })
      .mockResolvedValueOnce({
        getTextContent: jest.fn().mockResolvedValue({ items: [] }),
        cleanup: secondCleanup,
      });
    const destroy = jest.fn().mockResolvedValue(undefined);
    const getDocument = jest.fn().mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
      destroy,
    });
    jest.mocked(loadPdfJs).mockResolvedValue({ getDocument });
    const bytes = new Uint8Array([37, 80, 68, 70]);

    const pages = await extractObsidianPdfPageText(
      { bytes, maxPages: 4, maxCharacters: 100 },
      new AbortController().signal
    );

    expect(loadPdfJs).toHaveBeenCalledTimes(1);
    expect(getDocument).toHaveBeenCalledWith({ data: bytes, isEvalSupported: false });
    expect(getPage).toHaveBeenNthCalledWith(1, 1);
    expect(getPage).toHaveBeenNthCalledWith(2, 2);
    expect(pages).toEqual([
      { page: 1, text: "Alpha Beta\n尾" },
      { page: 2, text: "" },
    ]);
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(secondCleanup).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("sanitizes encrypted or corrupt loading failures and destroys the task once", async () => {
    const privateDetail = "PasswordException: encrypted/corrupt xref detail";
    const destroy = jest.fn().mockResolvedValue(undefined);
    jest.mocked(loadPdfJs).mockResolvedValue({
      getDocument: jest.fn().mockReturnValue({
        promise: Promise.reject(new Error(privateDetail)),
        destroy,
      }),
    });
    let failure: unknown;

    try {
      await extractObsidianPdfPageText(
        { bytes: new Uint8Array([1]), maxPages: 2, maxCharacters: 100 },
        new AbortController().signal
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: "PdfPageKnowledgeParserError",
      message: "The knowledge source is not a valid bounded PDF",
      code: "invalid_pdf",
    });
    expect(failure).not.toHaveProperty("cause");
    expect(String(failure)).not.toContain(privateDetail);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("cleans up and sanitizes a page text-content rejection", async () => {
    const privateDetail = "operator stream secret detail";
    const cleanup = jest.fn();
    const destroy = jest.fn().mockResolvedValue(undefined);
    jest.mocked(loadPdfJs).mockResolvedValue({
      getDocument: jest.fn().mockReturnValue({
        promise: Promise.resolve({
          numPages: 1,
          getPage: jest.fn().mockResolvedValue({
            getTextContent: jest.fn().mockRejectedValue(new Error(privateDetail)),
            cleanup,
          }),
        }),
        destroy,
      }),
    });
    let failure: unknown;

    try {
      await extractObsidianPdfPageText(
        { bytes: new Uint8Array([1]), maxPages: 2, maxCharacters: 100 },
        new AbortController().signal
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: "PdfPageKnowledgeParserError",
      message: "The knowledge source is not a valid bounded PDF",
      code: "invalid_pdf",
    });
    expect(failure).not.toHaveProperty("cause");
    expect(String(failure)).not.toContain(privateDetail);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("counts the item separator and line feed against the exact text limit", async () => {
    const cleanup = jest.fn();
    const destroy = jest.fn().mockResolvedValue(undefined);
    jest.mocked(loadPdfJs).mockResolvedValue({
      getDocument: jest.fn().mockReturnValue({
        promise: Promise.resolve({
          numPages: 1,
          getPage: jest.fn().mockResolvedValue({
            getTextContent: jest.fn().mockResolvedValue({
              items: [
                { str: "A", hasEOL: false },
                { str: "B", hasEOL: true },
              ],
            }),
            cleanup,
          }),
        }),
        destroy,
      }),
    });

    await expect(
      extractObsidianPdfPageText(
        { bytes: new Uint8Array([1]), maxPages: 2, maxCharacters: 3 },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "extracted_text_too_large" });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized document before page reads and still destroys it", async () => {
    const getPage = jest.fn();
    const destroy = jest.fn().mockResolvedValue(undefined);
    jest.mocked(loadPdfJs).mockResolvedValue({
      getDocument: jest.fn().mockReturnValue({
        promise: Promise.resolve({ numPages: 3, getPage }),
        destroy,
      }),
    });

    await expect(
      extractObsidianPdfPageText(
        { bytes: new Uint8Array([1]), maxPages: 2, maxCharacters: 100 },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "page_limit_exceeded" });
    expect(getPage).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("awaits abort-triggered loading-task destruction before rejecting", async () => {
    let rejectLoading: ((reason?: unknown) => void) | undefined;
    let finishDestroy: (() => void) | undefined;
    const loadingPromise = new Promise<unknown>((_resolve, reject) => {
      rejectLoading = reject;
    });
    const destroy = jest.fn(() => {
      rejectLoading?.(new Error("destroyed"));
      return new Promise<void>((resolve) => {
        finishDestroy = resolve;
      });
    });
    const getDocument = jest.fn().mockReturnValue({ promise: loadingPromise, destroy });
    jest.mocked(loadPdfJs).mockResolvedValue({ getDocument });
    const controller = new AbortController();

    const extraction = extractObsidianPdfPageText(
      { bytes: new Uint8Array([1]), maxPages: 2, maxCharacters: 100 },
      controller.signal
    );
    const assertion = expect(extraction).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    await Promise.resolve();
    expect(getDocument).toHaveBeenCalledTimes(1);
    controller.abort(new Error("must not escape"));
    await Promise.resolve();

    expect(destroy).toHaveBeenCalledTimes(1);
    let settled = false;
    void extraction.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    finishDestroy?.();
    await assertion;
    expect(settled).toBe(true);
  });
});
