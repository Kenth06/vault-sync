import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const LINTABLE = /\.(?:[cm]?[jt]sx?)$/u;
const COMMENT_CHECKED = /\.(?:[cm]?ts|tsx)$/u;

const input = JSON.parse(readFileSync(0, "utf8"));
const file = String(input.tool_input?.file_path ?? "");
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const oxlint = path.join(root, "node_modules", "oxlint", "bin", "oxlint");

if (!LINTABLE.test(file) || !existsSync(file) || !existsSync(oxlint)) process.exit(0);

const run = (args) => spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
const results = [run([oxlint, "-c", path.join(root, ".oxlintrc.json"), file])];
if (COMMENT_CHECKED.test(file) && !file.endsWith(".d.ts")) {
  results.push(run([path.join(root, "scripts", "check-comments.mjs"), file]));
}

const failed = results.filter((r) => r.status !== 0);
if (failed.length > 0) {
  const output = failed.map((r) => `${r.stdout}${r.stderr}`).join("\n");
  process.stderr.write(`Problems in ${path.relative(root, file)}:\n${output}`);
  process.exit(2);
}
