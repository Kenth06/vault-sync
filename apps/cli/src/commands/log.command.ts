import path from "node:path";

import { normalizeVaultPath, TreeEntry, type ChangeRow } from "@vault-sync/protocol";
import type { Command } from "commander";

import { ApiClient } from "../clients/api.client.ts";
import { downloadVerified } from "../services/restore.service.ts";
import { loadVault } from "../storage/vault-config.ts";
import { formatBytes, formatDate, shortHash } from "../utils/format.ts";

interface LogOptions {
  readonly version?: string;
  readonly out?: string;
}

function describe(row: ChangeRow): string {
  const size = row.size === null ? "" : formatBytes(row.size);
  const from = row.fromPath === null ? "" : ` (from ${row.fromPath})`;
  return `${String(row.seq).padStart(6)}  ${formatDate(row.at)}  ${row.op.padEnd(6)}  ${shortHash(row.hash)}  ${size.padStart(9)}${from}`;
}

function versionFileName(vaultPath: string, seq: number): string {
  const ext = path.extname(vaultPath);
  return `${vaultPath.slice(0, vaultPath.length - ext.length)} (v${seq})${ext}`;
}

async function recover(client: ApiClient, root: string, rows: ChangeRow[], options: LogOptions): Promise<void> {
  const seq = Number(options.version);
  const row = rows.find((r) => r.seq === seq);
  if (!row || row.hash === null) throw new Error(`no stored content for version ${options.version ?? ""}`);
  const target = path.resolve(root, options.out ?? versionFileName(row.path, row.seq));
  const entry = TreeEntry.parse({ path: row.path, hash: row.hash, size: row.size ?? 0, mtime: row.mtime ?? row.at });
  await downloadVerified(client, entry, target);
  console.log(`Wrote version ${row.seq} of ${row.path} to ${target}`);
}

async function log(file: string, dir: string, options: LogOptions): Promise<void> {
  const ctx = await loadVault(dir);
  const normalized = normalizeVaultPath(path.isAbsolute(file) ? path.relative(ctx.root, file) : file);
  if (!normalized.ok) throw new Error(`invalid vault path: ${normalized.reason}`);
  const client = new ApiClient(ctx.config.url, ctx.token);
  const rows = await client.history(ctx.config.vaultId, normalized.path);
  if (options.version !== undefined) {
    await recover(client, ctx.root, rows, options);
    return;
  }
  if (rows.length === 0) console.log(`No history for ${normalized.path}.`);
  for (const row of rows) console.log(describe(row));
}

export function registerLog(program: Command): void {
  program
    .command("log")
    .description("List the versions of a file, or recover one with --version")
    .argument("<path>", "file path inside the vault")
    .argument("[dir]", "vault directory", ".")
    .option("--version <seq>", "write that version to disk")
    .option("--out <file>", "where to write the recovered version")
    .action(log);
}
