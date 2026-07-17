import { KNOWLEDGE_COMPILER_PROTOCOL_VERSION } from "@/knowledge/compiler/CompilerModelPort";
import {
  parseCompilerAnalysisModelOutput,
  type CompilerAnalysisModelOutput,
} from "@/knowledge/compiler/analysisSchema";

/** Creates one representative, fully populated first-stage model output. */
function createValidAnalysisOutput(): CompilerAnalysisModelOutput {
  return {
    version: KNOWLEDGE_COMPILER_PROTOCOL_VERSION,
    summary: "The source describes a knowledge compiler and its evidence boundary.",
    concepts: [
      {
        ref: "concept-compiler",
        name: "Knowledge compiler",
        description: "A deterministic two-stage compilation boundary.",
      },
    ],
    entities: [
      {
        ref: "entity-schema",
        name: "Strict schema",
        type: "contract",
        description: "The runtime contract applied to untrusted model output.",
      },
    ],
    claims: [
      {
        ref: "claim-structured-output",
        text: "Both compiler stages require decoded structured output.",
      },
    ],
    relations: [
      {
        ref: "relation-validates",
        fromRef: "concept-compiler",
        toRef: "entity-schema",
        type: "validated_by",
      },
    ],
    citations: [
      {
        claimRef: "claim-structured-output",
        evidenceId: "evidence-1",
        relation: "supports",
      },
    ],
    targets: [
      {
        ref: "target-compiler",
        path: "Personal Knowledge/Compiler.md",
        intent: "write",
        reason: "Create the approved compiler page.",
        claimRefs: ["claim-structured-output"],
      },
    ],
  };
}

/** Asserts that untrusted analysis output fails closed with safe diagnostics. */
function expectRejected(value: unknown): void {
  const result = parseCompilerAnalysisModelOutput(value);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.severity === "error")).toBe(true);
  }
}

describe("parseCompilerAnalysisModelOutput", () => {
  it("round-trips a valid decoded analysis object", () => {
    const fixture = createValidAnalysisOutput();

    const result = parseCompilerAnalysisModelOutput(fixture);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(fixture);
      expect(result.value).not.toBe(fixture);
    }
  });

  it("rejects unknown fields at the root and nested object boundaries", () => {
    const fixture = createValidAnalysisOutput();

    expectRejected({ ...fixture, unexpected: true });
    expectRejected({
      ...fixture,
      targets: [{ ...fixture.targets[0], unexpected: true }],
    });
  });

  it.each([
    JSON.stringify(createValidAnalysisOutput()),
    `\`\`\`json\n${JSON.stringify(createValidAnalysisOutput())}\n\`\`\``,
  ])("rejects JSON and code-fenced strings instead of extracting them", (value) => {
    expectRejected(value);
  });

  it("rejects target attempts to forge core-owned hashes, status, or validation", () => {
    const fixture = createValidAnalysisOutput();

    expectRejected({
      ...fixture,
      targets: [
        {
          ...fixture.targets[0],
          beforeHash: "a".repeat(64),
          status: "accepted",
          validation: { okfValid: true, citationsValid: true, linksValid: true },
        },
      ],
    });
  });

  it("bounds structural diagnostics from oversized malformed arrays", () => {
    const fixture = createValidAnalysisOutput();
    const result = parseCompilerAnalysisModelOutput({
      ...fixture,
      concepts: Array.from({ length: 512 }, () => ({})),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(256);
    }
  });
});
