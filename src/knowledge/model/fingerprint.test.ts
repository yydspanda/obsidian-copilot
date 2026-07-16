import {
  canonicalizeJson,
  createFileContentHash,
  createPipelineFingerprint,
  createQuoteHash,
  createSourceContentHash,
  normalizeCitationText,
} from "@/knowledge/model/fingerprint";
import type { JsonValue, PipelineFingerprintInput } from "@/knowledge/model/types";

/** Creates a complete fingerprint input with no provider credentials. */
function createFingerprintInput(): PipelineFingerprintInput {
  return {
    version: 1,
    contractVersion: 1,
    compilerVersion: "compiler-1",
    parser: {
      id: "markdown",
      version: "parser-1",
      configuration: { preserveHeadings: true, chunkSizes: [512, 1024] },
    },
    schemaHash: "a".repeat(64),
    model: {
      provider: "deepseek",
      model: "deepseek-chat",
      configuration: { temperature: 0, maxTokens: 4096 },
    },
    outputLanguage: "zh-CN",
    okfVersion: "0.1",
    citationContractVersion: 1,
  };
}

describe("source and transaction hashes", () => {
  it("hashes exact UTF-8 source bytes including CRLF and BOM differences", () => {
    const lf = createSourceContentHash("标题\n正文\n");

    expect(createSourceContentHash("标题\r\n正文\r\n")).not.toBe(lf);
    expect(createSourceContentHash("\ufeff标题\n正文\n")).not.toBe(lf);
  });

  it("hashes binary PDF bytes without a text conversion", () => {
    expect(createSourceContentHash(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10]))).toBe(
      "0716f9264c9fe19f5d7455276107f3ddcc1d3497f63d60689a73558ae8a1bf5e"
    );
  });

  it("preserves exact line endings in ChangeSet compare-and-swap hashes", () => {
    expect(createFileContentHash("a\n")).not.toBe(createFileContentHash("a\r\n"));
  });

  it("normalizes only citation line endings", () => {
    expect(normalizeCitationText(" 证据\r\n下一行 ")).toBe(" 证据\n下一行 ");
    expect(createQuoteHash(" 证据\r\n下一行 ")).toBe(createQuoteHash(" 证据\n下一行 "));
    expect(createQuoteHash(" 证据 ")).not.toBe(createQuoteHash("证据"));
    expect(createQuoteHash("\ufeff证据")).not.toBe(createQuoteHash("证据"));
  });
});

describe("canonicalizeJson", () => {
  it("sorts nested object keys while preserving array order", () => {
    expect(canonicalizeJson({ z: 1, nested: { b: true, a: null }, a: ["x", "y"] })).toBe(
      '{"a":["x","y"],"nested":{"a":null,"b":true},"z":1}'
    );
    expect(canonicalizeJson({ sequence: [1, 2] })).not.toBe(canonicalizeJson({ sequence: [2, 1] }));
  });

  it("rejects non-JSON, non-finite, and cyclic runtime values", () => {
    expect(() => canonicalizeJson(Number.NaN as unknown as JsonValue)).toThrow(TypeError);
    expect(() => canonicalizeJson(undefined as unknown as JsonValue)).toThrow(TypeError);
    expect(() => canonicalizeJson(new Date() as unknown as JsonValue)).toThrow(TypeError);

    const cyclic: Record<string, JsonValue> = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeJson(cyclic)).toThrow("cyclic");
  });
});

describe("createPipelineFingerprint", () => {
  it("is stable when configuration object insertion order changes", () => {
    const first = createFingerprintInput();
    const second = createFingerprintInput();
    second.model.configuration = { maxTokens: 4096, temperature: 0 };
    second.parser.configuration = { chunkSizes: [512, 1024], preserveHeadings: true };

    expect(createPipelineFingerprint(second)).toBe(createPipelineFingerprint(first));
  });

  it.each([
    ["contract", { contractVersion: 2 }],
    ["compiler", { compilerVersion: "compiler-2" }],
    ["schema", { schemaHash: "b".repeat(64) }],
    ["language", { outputLanguage: "en" }],
    ["OKF", { okfVersion: "0.2" }],
    ["citation", { citationContractVersion: 2 }],
  ])("changes when the %s contract changes", (_name, patch) => {
    const baseline = createFingerprintInput();
    const changed = { ...createFingerprintInput(), ...patch } as PipelineFingerprintInput;

    expect(createPipelineFingerprint(changed)).not.toBe(createPipelineFingerprint(baseline));
  });

  it("changes when parser or model behavior changes", () => {
    const baseline = createFingerprintInput();
    const changedParser = createFingerprintInput();
    changedParser.parser = { ...changedParser.parser, version: "parser-2" };
    const changedModel = createFingerprintInput();
    changedModel.model = {
      ...changedModel.model,
      model: "deepseek-reasoner",
      configuration: { temperature: 0.2 },
    };

    expect(createPipelineFingerprint(changedParser)).not.toBe(createPipelineFingerprint(baseline));
    expect(createPipelineFingerprint(changedModel)).not.toBe(createPipelineFingerprint(baseline));
  });

  it("rejects credential-like fields before they can enter a fingerprint", () => {
    const input = createFingerprintInput();
    input.model.configuration = { temperature: 0, apiKey: "must-not-be-hashed" };

    expect(() => createPipelineFingerprint(input)).toThrow("sensitive field 'apiKey'");
  });
});
