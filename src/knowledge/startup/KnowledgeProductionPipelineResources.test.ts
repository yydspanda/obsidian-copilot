import {
  createKnowledgeProductionPipelineResources,
  KNOWLEDGE_PRODUCTION_COMPILER_VERSION,
  KNOWLEDGE_PRODUCTION_PDF_SOURCE_LIMITS,
  KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS,
} from "@/knowledge/startup/KnowledgeProductionPipelineResources";
import {
  assertKnowledgeConfigurationContainsNoSecrets,
  canonicalizeJson,
} from "@/knowledge/model/fingerprint";

describe("Knowledge production pipeline resources", () => {
  it("publishes the durable no-change compiler behavior generation", () => {
    const resources = createKnowledgeProductionPipelineResources();

    expect(KNOWLEDGE_PRODUCTION_COMPILER_VERSION).toBe("knowledge-compiler-v2");
    expect(resources.profileOptions.compilerVersion).toBe("knowledge-compiler-v2");
  });

  it("creates owned text/PDF parsers and a matching immutable production profile", () => {
    const resources = createKnowledgeProductionPipelineResources();
    const textParserProfile = resources.parsers[0].getProfile();
    const pdfParserProfile = resources.parsers[1].getProfile();

    expect(textParserProfile).toMatchObject({
      id: "knowledge-utf8-text",
      pathSuffixes: [".markdown", ".md", ".txt"],
      configuration: {
        maxBytes: KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS.maxBytes,
        maxCharacters: KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS.maxCharacters,
      },
    });
    expect(pdfParserProfile).toMatchObject({
      id: "knowledge-pdf-pages",
      pathSuffixes: [".pdf"],
      configuration: {
        artifactKind: "pdf",
        isEvalSupported: false,
        maxBytes: KNOWLEDGE_PRODUCTION_PDF_SOURCE_LIMITS.maxBytes,
        maxPages: KNOWLEDGE_PRODUCTION_PDF_SOURCE_LIMITS.maxPages,
        maxCharacters: KNOWLEDGE_PRODUCTION_PDF_SOURCE_LIMITS.maxCharacters,
      },
    });
    expect(resources.profileOptions).toMatchObject({
      compilerVersion: KNOWLEDGE_PRODUCTION_COMPILER_VERSION,
      parsers: [textParserProfile, pdfParserProfile],
      outputLanguage: "source-language",
      supportedProviders: ["deepseek"],
    });
    expect(Object.isFrozen(resources)).toBe(true);
    expect(Object.isFrozen(resources.parsers)).toBe(true);
    expect(Object.isFrozen(resources.profileOptions)).toBe(true);
  });

  it("recreates the same secret-free profile while keeping parser capabilities distinct", () => {
    const first = createKnowledgeProductionPipelineResources();
    const second = createKnowledgeProductionPipelineResources();
    const serialized = canonicalizeJson(first.profileOptions as never);

    expect(first.parsers[0]).not.toBe(second.parsers[0]);
    expect(first.parsers[1]).not.toBe(second.parsers[1]);
    expect(canonicalizeJson(second.profileOptions as never)).toBe(serialized);
    expect(() =>
      assertKnowledgeConfigurationContainsNoSecrets(first.profileOptions.compilerConfiguration)
    ).not.toThrow();
    for (const parser of first.profileOptions.parsers) {
      expect(() =>
        assertKnowledgeConfigurationContainsNoSecrets(parser.configuration)
      ).not.toThrow();
    }
  });
});
