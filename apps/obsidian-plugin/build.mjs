import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const root = import.meta.dirname;
const outdir = path.join(root, "dist");

await mkdir(outdir, { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "main.ts")],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  outfile: path.join(outdir, "main.js"),
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  minify: process.argv.includes("--production"),
  sourcemap: process.argv.includes("--production") ? false : "inline",
  logLevel: "info",
});
await copyFile(path.join(root, "manifest.json"), path.join(outdir, "manifest.json"));
