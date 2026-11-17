import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const LINTABLE = /\.(?:[cm]?[jt]sx?)$/u;

const input = JSON.parse(readFileSync(0, "utf8"));
const file = String(input.tool_input?.file_path ?? "");
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const oxlint = path.join(root, "node_modules", "oxlint", "bin", "oxlint");

if (!LINTABLE.test(file) || !existsSync(file) || !existsSync(oxlint)) process.exit(0);

const result = spawnSync(process.execPath, [oxlint, "-c", path.join(root, ".oxlintrc.json"), file], {
  cwd: root,
  encoding: "utf8",
});

if (result.status !== 0) {
  process.stderr.write(`oxlint found problems in ${path.relative(root, file)}:\n${result.stdout}${result.stderr}`);
  process.exit(2);
}
