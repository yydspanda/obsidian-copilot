import { KNOWLEDGE_COMPILER_PROTOCOL_VERSION } from "@/knowledge/compiler/CompilerModelPort";
import {
  parseCompilerGenerationModelOutput,
  type CompilerGenerationModelOutput,
} from "@/knowledge/compiler/generationSchema";

const VALID_TARGET_SET_DIGEST = "a".repeat(64);

/** Creates one valid generation output containing both supported outcomes. */
function createValidGenerationOutput(): CompilerGenerationModelOutput {
  return {
    version: KNOWLEDGE_COMPILER_PROTOCOL_VERSION,
    targetSetDigest: VALID_TARGET_SET_DIGEST,
    files: [
      {
        targetId: "target-write",
        outcome: "write",
        afterContent: "# Compiler\n\nGenerated knowledge.",
      },
      {
        targetId: "target-unchanged",
        outcome: "unchanged",
      },
    ],
  };
}

/** Asserts that untrusted generation output fails closed with safe diagnostics. */
function expectRejected(value: unknown): void {
  const result = parseCompilerGenerationModelOutput(value);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.severity === "error")).toBe(true);
  }
}

describe("parseCompilerGenerationModelOutput", () => {
  it("round-trips valid write and unchanged discriminants", () => {
    const fixture = createValidGenerationOutput();

    const result = parseCompilerGenerationModelOutput(fixture);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(fixture);
      expect(result.value).not.toBe(fixture);
    }
  });

  it("rejects unknown root fields", () => {
    expectRejected({ ...createValidGenerationOutput(), unexpected: true });
  });

  it.each([
    JSON.stringify(createValidGenerationOutput()),
    `\`\`\`json\n${JSON.stringify(createValidGenerationOutput())}\n\`\`\``,
  ])("rejects JSON and code-fenced strings instead of extracting them", (value) => {
    expectRejected(value);
  });

  it("rejects an unapproved path supplied directly by generation", () => {
    const fixture = createValidGenerationOutput();

    expectRejected({
      ...fixture,
      files: [
        {
          ...fixture.files[0],
          path: "Personal Knowledge/Unapproved.md",
        },
      ],
    });
  });

  it("rejects core-owned hash, status, and validation fields", () => {
    const fixture = createValidGenerationOutput();

    expectRejected({
      ...fixture,
      status: "accepted",
      validation: { okfValid: true, citationsValid: true, linksValid: true },
    });
    expectRejected({
      ...fixture,
      files: [
        {
          ...fixture.files[0],
          afterHash: "b".repeat(64),
        },
      ],
    });
  });

  it("rejects a write outcome that omits afterContent", () => {
    const fixture = createValidGenerationOutput();

    expectRejected({
      ...fixture,
      files: [{ targetId: "target-write", outcome: "write" }],
    });
  });

  it("rejects afterContent on unchanged and unsupported discriminants", () => {
    const fixture = createValidGenerationOutput();

    expectRejected({
      ...fixture,
      files: [
        {
          targetId: "target-unchanged",
          outcome: "unchanged",
          afterContent: "Model output must not hide content on an unchanged result.",
        },
      ],
    });
    expectRejected({
      ...fixture,
      files: [{ targetId: "target-delete", outcome: "delete" }],
    });
  });

  it.each([
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    "g".repeat(64),
    "sha256:a" + "a".repeat(63),
  ])("rejects a malformed target-set digest: %s", (targetSetDigest) => {
    expectRejected({ ...createValidGenerationOutput(), targetSetDigest });
  });

  it("bounds structural diagnostics from oversized malformed arrays", () => {
    const fixture = createValidGenerationOutput();
    const result = parseCompilerGenerationModelOutput({
      ...fixture,
      files: Array.from({ length: 512 }, () => ({})),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(256);
    }
  });
});
