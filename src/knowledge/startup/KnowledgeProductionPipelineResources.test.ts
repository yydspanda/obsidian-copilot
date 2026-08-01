import {
  createKnowledgeProductionPipelineResources,
  KNOWLEDGE_PRODUCTION_COMPILER_VERSION,
  KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS,
} from "@/knowledge/startup/KnowledgeProductionPipelineResources";
import {
  assertKnowledgeConfigurationContainsNoSecrets,
  canonicalizeJson,
} from "@/knowledge/model/fingerprint";

describe("Knowledge production pipeline resources", () => {
  it("creates an owned UTF-8 registry and matching immutable production profile", () => {
    const resources = createKnowledgeProductionPipelineResources();
    const parserProfile = resources.parsers[0].getProfile();

    expect(parserProfile).toMatchObject({
      id: "knowledge-utf8-text",
      pathSuffixes: [".markdown", ".md", ".txt"],
      configuration: {
        maxBytes: KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS.maxBytes,
        maxCharacters: KNOWLEDGE_PRODUCTION_UTF8_SOURCE_LIMITS.maxCharacters,
      },
    });
    expect(resources.profileOptions).toMatchObject({
      compilerVersion: KNOWLEDGE_PRODUCTION_COMPILER_VERSION,
      parsers: [parserProfile],
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
