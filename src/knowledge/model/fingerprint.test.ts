import {
  canonicalizeJson,
  createFileContentHash,
  createKnowledgeBundleConfigDigest,
  createPipelineFingerprint,
  createQuoteHash,
  createSourceContentHash,
  isExactUint8Array,
  normalizeCitationText,
} from "@/knowledge/model/fingerprint";
import type { JsonValue, PipelineFingerprintInput } from "@/knowledge/model/types";

/** Creates a complete fingerprint input with no provider credentials. */
function createFingerprintInput(): PipelineFingerprintInput {
  return {
    version: 1,
    contractVersion: 1,
    compilerVersion: "compiler-1",
    compilerConfiguration: { maxContextPages: 20, maxTargets: 50 },
    bundleConfigDigest: "c".repeat(64),
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

describe("isExactUint8Array", () => {
  it("uses the TypedArray intrinsic brand instead of a spoofable toStringTag", () => {
    const spoofedUint16 = new Uint16Array([0x1234]);
    Object.defineProperty(spoofedUint16, Symbol.toStringTag, { value: "Uint8Array" });
    const spoofedDataView = new DataView(new ArrayBuffer(2));
    Object.defineProperty(spoofedDataView, Symbol.toStringTag, { value: "Uint8Array" });
    const bytes = new Uint8Array([1, 2]);
    let tagGetterCalls = 0;
    Object.defineProperty(bytes, Symbol.toStringTag, {
      get: () => {
        tagGetterCalls += 1;
        return "Uint16Array";
      },
    });

    expect(isExactUint8Array(spoofedUint16)).toBe(false);
    expect(isExactUint8Array(spoofedDataView)).toBe(false);
    expect(isExactUint8Array(bytes)).toBe(true);
    expect(tagGetterCalls).toBe(0);
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
    ["Bundle", { bundleConfigDigest: "d".repeat(64) }],
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

    const changedCompiler = createFingerprintInput();
    changedCompiler.compilerConfiguration = { maxContextPages: 21, maxTargets: 50 };
    expect(createPipelineFingerprint(changedCompiler)).not.toBe(
      createPipelineFingerprint(baseline)
    );
  });

  it.each([
    ["model", "apiKey", { temperature: 0, apiKey: "must-not-be-hashed" }],
    ["parser", "x-api-key", { "x-api-key": "must-not-be-hashed" }],
    ["compiler", "apiCredential", { apiCredential: "must-not-be-hashed" }],
  ] as const)("rejects credential-like %s fields before hashing", (target, key, configuration) => {
    const input = createFingerprintInput();
    if (target === "model") input.model.configuration = configuration;
    if (target === "parser") input.parser.configuration = configuration;
    if (target === "compiler") input.compilerConfiguration = configuration;

    expect(() => createPipelineFingerprint(input)).toThrow(`sensitive field '${key}'`);
  });
});

describe("createKnowledgeBundleConfigDigest", () => {
  it("binds every compiler-visible Bundle behavior field", () => {
    const bundle = {
      version: 1 as const,
      id: "personal",
      sourceRoots: ["Sources"],
      wikiRoot: "Wiki",
      schemaRef: "Schemas/personal.md",
      reviewMode: "always" as const,
    };
    const baseline = createKnowledgeBundleConfigDigest(bundle);

    expect(createKnowledgeBundleConfigDigest({ ...bundle, wikiRoot: "AnotherWiki" })).not.toBe(
      baseline
    );
    expect(
      createKnowledgeBundleConfigDigest({ ...bundle, sourceRoots: ["OtherSources"] })
    ).not.toBe(baseline);
    expect(
      createKnowledgeBundleConfigDigest({ ...bundle, schemaRef: "Schemas/other.md" })
    ).not.toBe(baseline);
    expect(createKnowledgeBundleConfigDigest({ ...bundle, reviewMode: "multi_file" })).not.toBe(
      baseline
    );
    expect(createKnowledgeBundleConfigDigest({ ...bundle, id: "work" })).not.toBe(baseline);
  });
});
