import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

const ALLOWED = [/^\/\/\s*oxlint-disable/u, /^#!/u];
const SKIP_DIRS = new Set(["node_modules", "dist", ".wrangler", ".turbo", "drizzle"]);
const SOURCE = /\.(?:[cm]?ts|tsx)$/u;

function sourceFiles(target) {
  if (statSync(target).isFile()) return [target];
  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(full);
    return SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

function commentsIn(file) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = new Map();
  const collect = (ranges) => {
    for (const range of ranges ?? []) found.set(range.pos, text.slice(range.pos, range.end));
  };
  const visit = (node) => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.getEnd()));
    ts.forEachChild(node, visit);
  };
  visit(source);
  collect(ts.getLeadingCommentRanges(text, source.endOfFileToken.getFullStart()));
  return [...found]
    .filter(([, comment]) => !ALLOWED.some((pattern) => pattern.test(comment)))
    .toSorted(([a], [b]) => a - b)
    .map(([pos, comment]) => {
      const { line } = source.getLineAndCharacterOfPosition(pos);
      return `${path.relative(process.cwd(), file)}:${line + 1}: ${comment.split("\n")[0]}`;
    });
}

const roots = process.argv.slice(2);
const violations = roots.flatMap(sourceFiles).flatMap(commentsIn);

if (violations.length > 0) {
  console.error(`Comments are not allowed in source files (${violations.length}):\n${violations.join("\n")}`);
  process.exit(1);
}
