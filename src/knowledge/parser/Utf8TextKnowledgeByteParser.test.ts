import {
  verifyKnowledgeParsedSource,
  type KnowledgeByteParserRequest,
} from "@/knowledge/parser/KnowledgeByteParser";
import {
  UTF8_TEXT_KNOWLEDGE_PARSER_VERSION,
  Utf8TextKnowledgeByteParser,
  Utf8TextKnowledgeParserError,
} from "@/knowledge/parser/Utf8TextKnowledgeByteParser";
import { createFileContentHash, createSourceContentHash } from "@/knowledge/model/fingerprint";

const MAX_BYTES = 1_024;
const MAX_CHARACTERS = 1_024;

/** Creates the built-in parser with stable test limits. */
function createParser(
  limits: { maxBytes?: number; maxCharacters?: number } = {}
): Utf8TextKnowledgeByteParser {
  return new Utf8TextKnowledgeByteParser({
    id: "utf8-text",
    pathSuffixes: [".TXT", ".md"],
    maxBytes: limits.maxBytes ?? MAX_BYTES,
    maxCharacters: limits.maxCharacters ?? MAX_CHARACTERS,
  });
}

/** Creates one exact parser request over already observed bytes. */
function createRequest(bytes: Uint8Array): KnowledgeByteParserRequest {
  return {
    sourceId: "source-1",
    sourcePath: "Sources/研究.md",
    sourceContentHash: createSourceContentHash(bytes),
    bytes,
  };
}

describe("Utf8TextKnowledgeByteParser", () => {
  it("round-trips BOM, CRLF, Chinese, and emoji without changing exact bytes", async () => {
    const text = "\ufeff标题\r\n正文 🦌\r\n";
    const bytes = new TextEncoder().encode(text);
    const request = createRequest(bytes);
    const parser = createParser();

    const raw = await parser.parse(request, new AbortController().signal);
    const parsed = verifyKnowledgeParsedSource(raw, request, MAX_CHARACTERS);

    expect(parsed.artifact).toEqual({
      kind: "text",
      sourceId: "source-1",
      artifactId: "primary",
      artifactContentHash: createFileContentHash(text),
      text,
    });
    if (parsed.artifact.kind !== "text") throw new Error("Expected text artifact");
    expect([...new TextEncoder().encode(parsed.artifact.text)]).toEqual([...bytes]);
    expect(request.bytes).toBe(bytes);
  });

  it("exposes the exact immutable behavior profile used by fingerprinting", () => {
    const parser = createParser({ maxBytes: 12, maxCharacters: 8 });

    expect(parser.getProfile()).toEqual({
      id: "utf8-text",
      version: UTF8_TEXT_KNOWLEDGE_PARSER_VERSION,
      pathSuffixes: [".md", ".txt"],
      configuration: {
        artifactKind: "text",
        encoding: "utf-8",
        fatalDecoding: true,
        preserveBom: true,
        preserveLineEndings: true,
        requireByteRoundTrip: true,
        maxBytes: 12,
        maxCharacters: 8,
      },
    });
    expect(Object.isFrozen(parser.getProfile())).toBe(true);
    expect(Object.isFrozen(parser.getProfile().pathSuffixes)).toBe(true);
    expect(Object.isFrozen(parser.getProfile().configuration)).toBe(true);
    expect(Object.isFrozen(parser)).toBe(true);
  });

  it("rejects malformed UTF-8", async () => {
    const parser = createParser();
    const request = createRequest(new Uint8Array([0xc3, 0x28]));

    await expect(parser.parse(request, new AbortController().signal)).rejects.toMatchObject({
      name: "Utf8TextKnowledgeParserError",
      code: "invalid_utf8",
    });
  });

  it.each([
    ["empty", new Uint8Array()],
    ["whitespace", new TextEncoder().encode(" \t\r\n")],
  ])("rejects %s decoded text", async (_name, bytes) => {
    const parser = createParser();

    await expect(
      parser.parse(createRequest(bytes), new AbortController().signal)
    ).rejects.toMatchObject({
      name: "Utf8TextKnowledgeParserError",
      code: "decoded_text_empty",
    });
  });

  it("enforces byte and decoded-character limits independently", async () => {
    const bytes = new TextEncoder().encode("中文");

    await expect(
      createParser({ maxBytes: bytes.length - 1 }).parse(
        createRequest(bytes),
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      name: "Utf8TextKnowledgeParserError",
      code: "source_too_large",
    });
    await expect(
      createParser({ maxCharacters: 1 }).parse(createRequest(bytes), new AbortController().signal)
    ).rejects.toMatchObject({
      name: "Utf8TextKnowledgeParserError",
      code: "decoded_text_too_large",
    });
  });

  it("honors cancellation before validation and after decoding", async () => {
    const parser = createParser();
    const request = createRequest(new TextEncoder().encode("source"));
    const controller = new AbortController();
    controller.abort(new Error("must not escape"));

    await expect(parser.parse(request, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
      message: "The knowledge byte parser operation was aborted",
    });

    let checks = 0;
    const abortAfterDecode = {
      get aborted(): boolean {
        checks += 1;
        return checks === 2;
      },
    } as AbortSignal;
    await expect(parser.parse(request, abortAfterDecode)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(checks).toBe(2);
  });

  it("detects bytes changed after fatal decoding and before artifact publication", async () => {
    const parser = createParser();
    const bytes = new TextEncoder().encode("source");
    const request = createRequest(bytes);
    let checks = 0;
    const mutateAfterDecode = {
      get aborted(): boolean {
        checks += 1;
        if (checks === 2) {
          bytes[0] ^= 0xff;
        }
        return false;
      },
    } as AbortSignal;

    await expect(parser.parse(request, mutateAfterDecode)).rejects.toEqual(
      expect.objectContaining<Partial<Utf8TextKnowledgeParserError>>({
        name: "Utf8TextKnowledgeParserError",
        code: "utf8_round_trip_failed",
      })
    );
    expect(checks).toBe(2);
  });
});
