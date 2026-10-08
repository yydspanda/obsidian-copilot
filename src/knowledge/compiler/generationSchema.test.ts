import {
  KNOWLEDGE_COMPILER_GENERATION_OUTPUT_VERSION,
  parseCompilerGenerationModelOutput,
  type CompilerGenerationModelOutput,
} from "@/knowledge/compiler/generationSchema";

const VALID_TARGET_SET_DIGEST = "a".repeat(64);

/** Creates one valid generation output containing both supported outcomes. */
function createValidGenerationOutput(): CompilerGenerationModelOutput {
  return {
    version: KNOWLEDGE_COMPILER_GENERATION_OUTPUT_VERSION,
    targetSetDigest: VALID_TARGET_SET_DIGEST,
    files: [
      {
        targetId: "target-write",
        outcome: "write",
        afterContent: "# Compiler\n\nGenerated knowledge.",
        claimCoverage: [{ claimId: "claim-write", excerpt: "Generated knowledge." }],
      },
      {
        targetId: "target-unchanged",
        outcome: "unchanged",
        claimCoverage: [{ claimId: "claim-unchanged", excerpt: "Retained knowledge." }],
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

describe("generationSchema", () => {
  describe("parseCompilerGenerationModelOutput()", () => {
    it("round-trips version-2 write and unchanged results with their claim witnesses — https://github.com/yydspanda/obsidian-copilot/issues/20", () => {
      const fixture = createValidGenerationOutput();

      const result = parseCompilerGenerationModelOutput(fixture);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(fixture);
        expect(result.value).not.toBe(fixture);
        expect(result.value.files[0]).not.toBe(fixture.files[0]);
        expect(result.value.files[1]).not.toBe(fixture.files[1]);
        expect(result.value.files[0].claimCoverage).not.toBe(fixture.files[0].claimCoverage);
        expect(result.value.files[0].claimCoverage[0]).not.toBe(fixture.files[0].claimCoverage[0]);
      }
    });

    it("allows empty coverage for targets whose coverage obligation is determined by the compiler — https://github.com/yydspanda/obsidian-copilot/issues/20", () => {
      const fixture = createValidGenerationOutput();
      fixture.files.forEach((file) => {
        file.claimCoverage = [];
      });

      expect(parseCompilerGenerationModelOutput(fixture)).toEqual({ ok: true, value: fixture });
    });

    it("preserves whitespace around nonblank claim IDs and excerpts without repairing them — https://github.com/yydspanda/obsidian-copilot/issues/20", () => {
      const fixture = createValidGenerationOutput();
      fixture.files[0].claimCoverage = [
        { claimId: " claim-write ", excerpt: " Generated knowledge.\n" },
      ];

      expect(parseCompilerGenerationModelOutput(fixture)).toEqual({ ok: true, value: fixture });
    });

    it("rejects version-1 generation rather than accepting output without a claim coverage contract — https://github.com/yydspanda/obsidian-copilot/issues/20", () => {
      const result = parseCompilerGenerationModelOutput({
        ...createValidGenerationOutput(),
        version: 1,
      });

      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.issues).toContainEqual(expect.objectContaining({ field: "version" }));
    });

    it.each(["write", "unchanged"])(
      "rejects a %s result that omits claimCoverage — https://github.com/yydspanda/obsidian-copilot/issues/20",
      (outcome) => {
        const fixture = createValidGenerationOutput();
        const file = fixture.files.find((candidate) => candidate.outcome === outcome);
        if (!file) throw new Error("Expected the coverage fixture outcome");
        const withoutCoverage: Record<string, unknown> = { ...file };
        delete withoutCoverage.claimCoverage;

        expectRejected({ ...fixture, files: [withoutCoverage] });
      }
    );

    it.each(["write", "unchanged"])(
      "rejects a %s result with a non-array coverage value — https://github.com/yydspanda/obsidian-copilot/issues/20",
      (outcome) => {
        const fixture = createValidGenerationOutput();
        const file = fixture.files.find((candidate) => candidate.outcome === outcome);

        expectRejected({ ...fixture, files: [{ ...file, claimCoverage: null }] });
      }
    );

    it.each([
      ["claimId", ""],
      ["claimId", " \n\t"],
      ["excerpt", ""],
      ["excerpt", " \n\t"],
    ])(
      "rejects a blank coverage %s (%j) in either outcome — https://github.com/yydspanda/obsidian-copilot/issues/20",
      (field, value) => {
        const fixture = createValidGenerationOutput();
        fixture.files.forEach((file) => {
          expectRejected({
            ...fixture,
            files: [
              {
                ...file,
                claimCoverage: [{ claimId: "claim", excerpt: "Claim witness.", [field]: value }],
              },
            ],
          });
        });
      }
    );

    it.each(["claimId", "excerpt"])(
      "rejects a coverage entry omitting %s in either outcome — https://github.com/yydspanda/obsidian-copilot/issues/20",
      (field) => {
        const fixture = createValidGenerationOutput();
        const entry: Record<string, string> = { claimId: "claim", excerpt: "Claim witness." };
        delete entry[field];

        fixture.files.forEach((file) => {
          expectRejected({ ...fixture, files: [{ ...file, claimCoverage: [entry] }] });
        });
      }
    );

    it("rejects authority and exclusion metadata inside coverage entries in either outcome — https://github.com/yydspanda/obsidian-copilot/issues/20", () => {
      const fixture = createValidGenerationOutput();
      fixture.files.forEach((file) => {
        expectRejected({
          ...fixture,
          files: [
            {
              ...file,
              claimCoverage: [
                {
                  claimId: "claim",
                  excerpt: "Claim witness.",
                  status: "excluded",
                  reason: "Optional.",
                },
              ],
            },
          ],
        });
      });
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
        files: [
          {
            targetId: "target-write",
            outcome: "write",
            claimCoverage: fixture.files[0].claimCoverage,
          },
        ],
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
            claimCoverage: fixture.files[1].claimCoverage,
          },
        ],
      });
      expectRejected({
        ...fixture,
        files: [{ targetId: "target-delete", outcome: "delete", claimCoverage: [] }],
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
});
