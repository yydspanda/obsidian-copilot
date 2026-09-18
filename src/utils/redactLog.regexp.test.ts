import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// A child process isolates V8 flags from the other Jest suites and production settings.
describe("redactLog", () => {
  describe("redactLogText()", () => {
    it("redacts complete 16 MiB credentials and addresses without regexp optimization, preserving surrounding text (https://github.com/yydspanda/obsidian-copilot/issues/12)", () => {
      const compiled = ts.transpileModule(readFileSync(join(__dirname, "redactLog.ts"), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      const script = String.raw`
          const exports = {};
          ${compiled}
          const huge = "A".repeat(16 * 1024 * 1024);
          const cases = [
            ["email", huge + "@example.com.", "<email>."],
            ["Basic", "Authorization: Basic " + huge, "Authorization: Basic <redacted>"],
            ["provider", "sk-" + huge, "<secret>"],
            ["Google", "AIza" + huge, "<secret>"],
            ["GitHub", "ghp_" + huge, "<secret>"],
            ["Slack", "xoxb-" + huge, "<secret>"],
            ["bearer", "bearer " + huge, "bearer <token>"],
            ["password", "password=" + huge, "password=<redacted>"],
            ["non-secret", huge, huge],
          ];
          const results = [];
          for (const boundary of ["", "\n中文 🎉\n"]) {
            for (const [shape, input, expected] of cases) {
              const actual = exports.redactLogText(boundary + input + boundary);
              results.push({ shape, boundary, matches: actual === boundary + expected + boundary });
            }
          }
          process.stdout.write(JSON.stringify(results));
        `;
      const result = spawnSync(process.execPath, ["--no-regexp-optimization", "-"], {
        input: script,
        encoding: "utf8",
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      });

      expect(result.error).toBeUndefined();
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
      const results = JSON.parse(result.stdout) as Array<{ matches: boolean }>;
      expect(results).toHaveLength(18);
      expect(results.filter((result) => !result.matches)).toEqual([]);
    }, 30_000);
  });
});
