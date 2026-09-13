"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertBundleSize,
  createBundleSizeGuard,
  dedupeEsbuildLegalComments,
  rewriteExactZodImports,
} = require("./bundleSizeGuard.js");

const LEGAL_PREFIX = "/*! Bundled license information:\n\n";
const LEGAL_SUFFIX = "*/\n";

function legalEntry(filePath, body) {
  return `${filePath}:\n${body}\n`;
}

function legalBundle(...entries) {
  return `runtime();\n${LEGAL_PREFIX}${entries.join("\n")}${LEGAL_SUFFIX}`;
}

describe("bundleSizeGuard", () => {
  describe("rewriteExactZodImports()", () => {
    it("rewrites exact z-only imports from zod and zod/v4 for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      expect(
        rewriteExactZodImports(
          [
            'import { z } from "zod";',
            "import { z as schema } from 'zod/v4';",
            "schema.string();",
          ].join("\n"),
          "dependency.js"
        )
      ).toBe(
        ['import * as z from "zod";', "import * as schema from 'zod/v4';", "schema.string();"].join(
          "\n"
        )
      );
    });

    it("leaves type-only, multi-symbol, namespace, unrelated, attributed, and string imports unchanged for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      const source = [
        'import type { z } from "zod";',
        'import zodDefault, { z } from "zod";',
        'import { z, ZodError } from "zod";',
        'import * as z from "zod";',
        'import { z } from "other";',
        'import { z } from "zod" with { type: "json" };',
        '// import { z } from "zod";',
        'const example = `import { z } from "zod";`;',
      ].join("\n");

      expect(rewriteExactZodImports(source, "dependency.ts")).toBe(source);
    });

    it("preserves comments inside exact imports for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      const source = [
        'import /*! Zod license */ { z } from "zod";',
        "import { /*! Required notice */ z as schema } from 'zod/v4';",
      ].join("\n");

      expect(rewriteExactZodImports(source, "dependency.js")).toBe(source);
    });
  });

  describe("createBundleSizeGuard()", () => {
    let originalOverride;
    let directory;
    let build;

    beforeEach(() => {
      originalOverride = process.env.COPILOT_PERSONAL_MAX_BUNDLE_BYTES;
      delete process.env.COPILOT_PERSONAL_MAX_BUNDLE_BYTES;
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-size-guard-"));
      build = {
        initialOptions: { outfile: path.join(directory, "main.js") },
        onEnd: jest.fn(),
        onLoad: jest.fn(),
      };
    });

    afterEach(() => {
      if (originalOverride === undefined) delete process.env.COPILOT_PERSONAL_MAX_BUNDLE_BYTES;
      else process.env.COPILOT_PERSONAL_MAX_BUNDLE_BYTES = originalOverride;
      fs.rmSync(directory, { recursive: true, force: true });
    });

    it("registers only dependency rewriting in development for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      createBundleSizeGuard({ production: false }).setup(build);

      expect(build.onLoad).toHaveBeenCalledTimes(1);
      expect(build.onEnd).not.toHaveBeenCalled();
    });

    it("registers dependency rewriting and artifact enforcement in production for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      createBundleSizeGuard({ production: true }).setup(build);

      expect(build.onLoad).toHaveBeenCalledTimes(1);
      expect(build.onEnd).toHaveBeenCalledTimes(1);
    });

    it.each(["10000000", "010000000"])(
      "writes a 9,999,999-byte artifact under override %s while preserving unique notices and deduplicating before enforcement for https://github.com/yydspanda/obsidian-copilot/issues/4",
      (override) => {
        const guard = createBundleSizeGuard({ production: true });
        process.env.COPILOT_PERSONAL_MAX_BUNDLE_BYTES = override;
        const alpha = "  (*!\n   * License α  \n   *)";
        const beta = "  (** @license β *)";
        const legalOutput = legalBundle(
          legalEntry("first-alpha.js (+1 identical notices)", alpha),
          legalEntry("only-beta.js", beta)
        );
        const padding = " ".repeat(9_999_999 - Buffer.byteLength(legalOutput, "utf8"));
        const source =
          padding +
          legalBundle(
            legalEntry("first-alpha.js", alpha),
            legalEntry("only-beta.js", beta),
            legalEntry("second-alpha.js", alpha)
          );
        fs.writeFileSync(build.initialOptions.outfile, source, "utf8");
        guard.setup(build);

        build.onEnd.mock.calls[0][0]({ errors: [] });

        expect(Buffer.byteLength(source, "utf8")).toBeGreaterThan(10_000_000);
        expect(fs.readFileSync(build.initialOptions.outfile, "utf8")).toBe(padding + legalOutput);
        expect(fs.statSync(build.initialOptions.outfile).size).toBe(9_999_999);
      }
    );

    it("keeps the strict 5,000,000-byte default when the override is absent for https://github.com/yydspanda/obsidian-copilot/issues/4", () => {
      const legal = legalBundle(legalEntry("dependency.js", "  (*! notice *)"));
      const source = " ".repeat(4_999_999 - Buffer.byteLength(legal, "utf8")) + legal;
      fs.writeFileSync(build.initialOptions.outfile, source, "utf8");
      createBundleSizeGuard({ production: true }).setup(build);
      const onEnd = build.onEnd.mock.calls[0][0];

      onEnd({ errors: [] });

      expect(fs.readFileSync(build.initialOptions.outfile, "utf8")).toBe(source);
      fs.writeFileSync(build.initialOptions.outfile, " " + source, "utf8");
      expect(() => onEnd({ errors: [] })).toThrow("strictly below 5000000 bytes");
      expect(fs.readFileSync(build.initialOptions.outfile, "utf8")).toBe(" " + source);
    });

    it.each([10_000_000, 10_000_001])(
      "rejects a %i-byte artifact at or above the personal ceiling without rewriting it for https://github.com/yydspanda/obsidian-copilot/issues/4",
      (bytes) => {
        process.env.COPILOT_PERSONAL_MAX_BUNDLE_BYTES = "10000000";
        const legal = legalBundle(legalEntry("dependency.js", "  (*! notice *)"));
        const source = " ".repeat(bytes - Buffer.byteLength(legal, "utf8")) + legal;
        fs.writeFileSync(build.initialOptions.outfile, source, "utf8");
        createBundleSizeGuard({ production: true }).setup(build);

        expect(() => build.onEnd.mock.calls[0][0]({ errors: [] })).toThrow(
          "strictly below 10000000 bytes"
        );
        expect(fs.readFileSync(build.initialOptions.outfile, "utf8")).toBe(source);
      }
    );

    it.each(["1", "9007199254740991"])(
      "accepts the positive safe-integer override %s during production setup for https://github.com/yydspanda/obsidian-copilot/issues/4",
      (override) => {
        process.env.COPILOT_PERSONAL_MAX_BUNDLE_BYTES = override;

        createBundleSizeGuard({ production: true }).setup(build);

        expect(build.onEnd).toHaveBeenCalledTimes(1);
      }
    );

    it.each([
      "",
      " ",
      " 10000000",
      "10000000 ",
      "10000000\n",
      "1.5",
      "NaN",
      "Infinity",
      "0",
      "000",
      "-1",
      "+10000000",
      "0x100",
      "1e7",
      "1_000_000",
      "invalid",
      "9007199254740992",
    ])(
      "rejects invalid override %j during production setup with the variable name for https://github.com/yydspanda/obsidian-copilot/issues/4",
      (override) => {
        process.env.COPILOT_PERSONAL_MAX_BUNDLE_BYTES = override;

        expect(() => createBundleSizeGuard({ production: true }).setup(build)).toThrow(
          "COPILOT_PERSONAL_MAX_BUNDLE_BYTES"
        );
      }
    );

    it.each(["10000000", "invalid"])(
      "ignores override %s in development and registers no artifact enforcement for https://github.com/yydspanda/obsidian-copilot/issues/4",
      (override) => {
        process.env.COPILOT_PERSONAL_MAX_BUNDLE_BYTES = override;

        createBundleSizeGuard({ production: false }).setup(build);

        expect(build.onLoad).toHaveBeenCalledTimes(1);
        expect(build.onEnd).not.toHaveBeenCalled();
      }
    );

    it("still rejects malformed license blocks with a personal override without rewriting the artifact for https://github.com/yydspanda/obsidian-copilot/issues/4", () => {
      process.env.COPILOT_PERSONAL_MAX_BUNDLE_BYTES = "10000000";
      const source = `runtime();\n/*! Bundled license information:\n${LEGAL_SUFFIX}`;
      fs.writeFileSync(build.initialOptions.outfile, source, "utf8");
      createBundleSizeGuard({ production: true }).setup(build);

      expect(() => build.onEnd.mock.calls[0][0]({ errors: [] })).toThrow(
        "malformed esbuild legal-comment block header"
      );
      expect(fs.readFileSync(build.initialOptions.outfile, "utf8")).toBe(source);
    });
  });

  describe("dedupeEsbuildLegalComments()", () => {
    it("keeps first-seen order and every unique notice body byte-for-byte while counting identical notices for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      const alpha = "  (*!\n   * License α  \n   *)";
      const beta = "  (** @license β *)";
      const source = legalBundle(
        legalEntry("first-alpha.js", alpha),
        legalEntry("only-beta.js", beta),
        legalEntry("second-alpha.js", alpha)
      );

      expect(dedupeEsbuildLegalComments(source)).toBe(
        legalBundle(
          legalEntry("first-alpha.js (+1 identical notices)", alpha),
          legalEntry("only-beta.js", beta)
        )
      );
    });

    it.each([
      ["missing", "runtime();\n"],
      ["malformed header", `runtime();\n/*! Bundled license information:\n${LEGAL_SUFFIX}`],
      ["malformed footer", `runtime();\n${LEGAL_PREFIX}${legalEntry("a.js", "  (*! notice *)")}*/`],
      [
        "multiple",
        `${legalBundle(legalEntry("a.js", "  (*! notice *)"))}${legalBundle(
          legalEntry("b.js", "  (*! other *)")
        )}`,
      ],
      ["non-EOF", `${legalBundle(legalEntry("a.js", "  (*! notice *)"))}runtime();\n`],
      ["incomplete entry", `runtime();\n${LEGAL_PREFIX}a.js:\n  (*! notice *\n${LEGAL_SUFFIX}`],
    ])(
      "fails closed on a %s legal block for https://github.com/Brevilabs/obsidian-copilot-private/issues/94",
      (_caseName, source) => {
        expect(() => dedupeEsbuildLegalComments(source)).toThrow("[bundle-size-guard]");
      }
    );
  });

  describe("assertBundleSize()", () => {
    it("uses the 5 MB ceiling for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      expect(assertBundleSize("a".repeat(4_999_999))).toBe(4_999_999);
      expect(() => assertBundleSize("a".repeat(5_000_000))).toThrow("strictly below 5000000 bytes");
    });

    it("measures UTF-8 bytes and enforces a strict boundary for https://github.com/Brevilabs/obsidian-copilot-private/issues/94", () => {
      expect(assertBundleSize("é", 3)).toBe(2);
      expect(() => assertBundleSize("é", 2)).toThrow("strictly below 2 bytes");
    });
  });
});
