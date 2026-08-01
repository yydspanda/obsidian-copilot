import {
  KnowledgeByteParserInputError,
  KnowledgeByteParserOutputError,
  verifyKnowledgeByteParserRequest,
  verifyKnowledgeParsedSource,
  type KnowledgeByteParserRequest,
} from "@/knowledge/parser/KnowledgeByteParser";
import { createFileContentHash, createSourceContentHash } from "@/knowledge/model/fingerprint";

/** Creates one exact request whose hash belongs to the supplied bytes. */
function createRequest(
  bytes = new TextEncoder().encode("exact source")
): KnowledgeByteParserRequest {
  return {
    sourceId: "source-1",
    sourcePath: "Sources/研究.md",
    sourceContentHash: createSourceContentHash(bytes),
    bytes,
  };
}

/** Creates one valid parser success for the supplied source identity. */
function createParsedSource(sourceId = "source-1", text = "parsed source") {
  return {
    artifact: {
      kind: "text" as const,
      sourceId,
      artifactId: "primary",
      artifactContentHash: createFileContentHash(text),
      text,
    },
  };
}

describe("verifyKnowledgeByteParserRequest", () => {
  it("preserves the exact byte reference in a frozen detached request", () => {
    const bytes = new TextEncoder().encode("\ufeff标题\r\n正文 🦌\r\n");
    const input = createRequest(bytes);

    const verified = verifyKnowledgeByteParserRequest(input);

    expect(verified).not.toBe(input);
    expect(verified.bytes).toBe(bytes);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(verified).toEqual(input);
  });

  it("rejects input accessors without invoking them", () => {
    const input = createRequest();
    let getterCalls = 0;
    Object.defineProperty(input, "bytes", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return new Uint8Array([1]);
      },
    });

    expect(() => verifyKnowledgeByteParserRequest(input)).toThrow(KnowledgeByteParserInputError);
    expect(getterCalls).toBe(0);
  });

  it("rejects extra fields and a source hash that does not match the bytes", () => {
    const request = createRequest();

    expect(() => verifyKnowledgeByteParserRequest({ ...request, unexpected: true })).toThrow(
      KnowledgeByteParserInputError
    );
    expect(() =>
      verifyKnowledgeByteParserRequest({
        ...request,
        sourceContentHash: "f".repeat(64),
      })
    ).toThrow(KnowledgeByteParserInputError);
  });

  it("detects mutation of bytes retained by an already verified request", () => {
    const verified = verifyKnowledgeByteParserRequest(createRequest());
    verified.bytes[0] ^= 0xff;

    expect(() => verifyKnowledgeByteParserRequest(verified)).toThrow(KnowledgeByteParserInputError);
  });
});

describe("verifyKnowledgeParsedSource", () => {
  it("returns a detached deeply frozen exact artifact", () => {
    const request = verifyKnowledgeByteParserRequest(createRequest());
    const output = createParsedSource();

    const verified = verifyKnowledgeParsedSource(output, request, 1_000);

    expect(verified).not.toBe(output);
    expect(verified.artifact).not.toBe(output.artifact);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.artifact)).toBe(true);
    expect(verified).toEqual(output);
  });

  it("rejects root and nested output accessors without invoking them", () => {
    const request = verifyKnowledgeByteParserRequest(createRequest());
    let rootGetterCalls = 0;
    const rootAccessor = Object.defineProperty({}, "artifact", {
      enumerable: true,
      get: () => {
        rootGetterCalls += 1;
        return createParsedSource().artifact;
      },
    });

    expect(() => verifyKnowledgeParsedSource(rootAccessor, request, 1_000)).toThrow(
      KnowledgeByteParserOutputError
    );
    expect(rootGetterCalls).toBe(0);

    const nestedAccessor = createParsedSource();
    let nestedGetterCalls = 0;
    Object.defineProperty(nestedAccessor.artifact, "text", {
      enumerable: true,
      get: () => {
        nestedGetterCalls += 1;
        return "must not be read";
      },
    });

    expect(() => verifyKnowledgeParsedSource(nestedAccessor, request, 1_000)).toThrow(
      KnowledgeByteParserOutputError
    );
    expect(nestedGetterCalls).toBe(0);
  });

  it("rejects extra fields at either output level", () => {
    const request = verifyKnowledgeByteParserRequest(createRequest());
    const output = createParsedSource();

    expect(() =>
      verifyKnowledgeParsedSource({ ...output, unexpected: true }, request, 1_000)
    ).toThrow(KnowledgeByteParserOutputError);
    expect(() =>
      verifyKnowledgeParsedSource(
        { artifact: { ...output.artifact, unexpected: true } },
        request,
        1_000
      )
    ).toThrow(KnowledgeByteParserOutputError);
  });

  it("rejects artifact hash, source identity, and character-limit mismatches", () => {
    const request = verifyKnowledgeByteParserRequest(createRequest());
    const output = createParsedSource();

    expect(() =>
      verifyKnowledgeParsedSource(
        {
          artifact: {
            ...output.artifact,
            artifactContentHash: "f".repeat(64),
          },
        },
        request,
        1_000
      )
    ).toThrow(KnowledgeByteParserOutputError);
    expect(() =>
      verifyKnowledgeParsedSource(createParsedSource("another-source"), request, 1_000)
    ).toThrow(KnowledgeByteParserOutputError);
    expect(() =>
      verifyKnowledgeParsedSource(output, request, output.artifact.text.length - 1)
    ).toThrow(KnowledgeByteParserOutputError);
    expect(() =>
      verifyKnowledgeParsedSource(createParsedSource("source-1", " \r\n\t"), request, 1_000)
    ).toThrow(KnowledgeByteParserOutputError);
  });
});
