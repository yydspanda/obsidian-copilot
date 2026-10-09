import { spawnSync } from "node:child_process";
import path from "node:path";

const ISSUE = "https://github.com/yydspanda/obsidian-copilot/issues/22";

// Evaluate the real entrypoint with inert dependencies so lifecycle failures cannot
// overwrite the plugin artifact or terminate the Jest worker.
function runBuildConfig(mode, failRebuild = false) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-vm-modules",
      "--input-type=module",
      "-",
      path.resolve(__dirname, "../esbuild.config.mjs"),
      mode,
      String(failRebuild),
    ],
    {
      encoding: "utf8",
      timeout: 5000,
      input: `
        import { readFileSync } from "node:fs";
        import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
        const events = [];
        const context = createContext({});
        const buildContext = {
          async rebuild() {
            events.push("rebuild");
            if (process.argv[4] === "true") throw new Error("deliberate rebuild failure");
          },
          async dispose() {
            await new Promise((resolve) => setTimeout(resolve, 10));
            events.push("dispose");
          },
          async watch() { events.push("watch"); },
        };
        const dependencies = {
          esbuild: { default: { async context() { return buildContext; } } },
          process: { default: {
            argv: ["node", process.argv[2], process.argv[3]],
            exit(code) { events.push("exit:" + code); },
          } },
          module: { createRequire: () => (name) =>
            name.endsWith("bundleSizeGuard.js") ? { createBundleSizeGuard: () => ({}) } : {} },
          "./wasmPlugin.mjs": { default: {} },
          "./nodeModuleShim.mjs": { default: {}, nodeBuiltinExternals: [] },
          "./svgrPlugin.mjs": { default: {} },
        };
        const entrypoint = new SourceTextModule(readFileSync(process.argv[2], "utf8"), { context });
        await entrypoint.link((name) => {
          const exports = dependencies[name];
          return new SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
          }, { context });
        });
        let error;
        try { await entrypoint.evaluate(); } catch (failure) { error = failure.message; }
        process.stdout.write(JSON.stringify({ events, error }));
      `,
    }
  );
  if (result.error) throw result.error;
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

describe("esbuild.config", () => {
  describe("production build lifecycle", () => {
    it(`disposes the completed build context without forcing process exit — ${ISSUE}`, () => {
      expect(runBuildConfig("production")).toEqual({ events: ["rebuild", "dispose"] });
    });

    it(`disposes the context and preserves the original rebuild failure — ${ISSUE}`, () => {
      expect(runBuildConfig("production", true)).toEqual({
        events: ["rebuild", "dispose"],
        error: "deliberate rebuild failure",
      });
    });

    it("keeps the development context alive for watch mode", () => {
      expect(runBuildConfig("development")).toEqual({ events: ["watch"] });
    });
  });
});
