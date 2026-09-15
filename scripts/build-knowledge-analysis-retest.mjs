import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nodeModuleShim, { nodeBuiltinExternals } from "../nodeModuleShim.mjs";
import svgrPlugin from "../svgrPlugin.mjs";
import wasmPlugin from "../wasmPlugin.mjs";

// Diagnostic artifacts must never replace the production bundle or install themselves.
// https://github.com/yydspanda/obsidian-copilot/issues/8
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "copilot-analysis-retest-"));
const entry = join(root, "scripts/knowledge-analysis-retest.ts");
await build({
  absWorkingDir: root,
  entryPoints: [entry],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...nodeBuiltinExternals],
  format: "cjs",
  target: "es2020",
  treeShaking: true,
  outfile: join(directory, "main.js"),
  loader: { ".md": "text" },
  plugins: [nodeModuleShim, svgrPlugin, wasmPlugin],
  define: { global: "window", "process.env.NODE_ENV": '"production"' },
});
await writeFile(
  join(directory, "manifest.json"),
  JSON.stringify(
    {
      id: "copilot-isolated-analysis-retest",
      name: "Temporary isolated Copilot analysis check",
      version: "0.0.2",
      minAppVersion: "1.8.0",
      description: "Manual, single-source in-memory acceptance diagnostic.",
      author: "Local acceptance",
      isDesktopOnly: true,
    },
    null,
    2
  ) + "\n"
);
const artifact = await readFile(join(directory, "main.js"));
process.stdout.write(
  JSON.stringify(
    {
      directory,
      mainJsBytes: artifact.byteLength,
      mainJsSha256: createHash("sha256").update(artifact).digest("hex"),
      sourceSha256: createHash("sha256")
        .update(await readFile(entry))
        .digest("hex"),
    },
    null,
    2
  ) + "\n"
);
