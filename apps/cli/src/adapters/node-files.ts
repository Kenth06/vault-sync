import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { normalizeVaultPath } from "@vault-sync/protocol";
import type { ByteRange, Bytes, FileMeta, FileStat, LocalFiles, WriteOptions } from "@vault-sync/sync-core";

import { MAX_HASH_ATTEMPTS, TMP_SUFFIX } from "../common/constants.ts";
import { assertInside, lexicalTarget } from "../services/fs-safety.ts";
import type { LocalState } from "../storage/local-state.ts";

const MS_PER_SECOND = 1000;

function toNodeStream(content: Bytes): Readable {
  return content instanceof ArrayBuffer ? Readable.from(Buffer.from(content)) : Readable.fromWeb(content);
}

function hashingStream(hash: ReturnType<typeof createHash>): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
}

async function sha256File(absPath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(absPath), hash);
  return hash.digest("hex");
}

async function statOf(absPath: string, vaultPath: string): Promise<FileStat | null> {
  const info = await stat(absPath).catch(() => null);
  return info?.isFile() === true ? { path: vaultPath, size: info.size, mtime: Math.trunc(info.mtimeMs) } : null;
}

export class NodeFiles implements LocalFiles {
  private readonly root: string;
  private readonly state: LocalState;

  constructor(root: string, state: LocalState) {
    this.root = root;
    this.state = state;
  }

  async list(): Promise<FileStat[]> {
    const entries = await readdir(this.root, { recursive: true, withFileTypes: true });
    const files: FileStat[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const absPath = path.join(entry.parentPath, entry.name);
      const normalized = normalizeVaultPath(path.relative(this.root, absPath));
      const file = normalized.ok ? await statOf(absPath, normalized.path) : null;
      if (file) files.push(file);
    }
    return files;
  }

  stat(vaultPath: string): Promise<FileStat | null> {
    return statOf(this.abs(vaultPath), vaultPath);
  }

  async hash(file: FileStat): Promise<FileMeta | null> {
    const cached = this.state.cachedHash(file.path, file.size, file.mtime);
    if (cached !== null) return { hash: cached, size: file.size, mtime: file.mtime };
    for (let attempt = 0; attempt < MAX_HASH_ATTEMPTS; attempt += 1) {
      const before = await this.stat(file.path);
      const hash = await sha256File(this.abs(file.path));
      const after = await this.stat(file.path);
      if (before && after && before.size === after.size && before.mtime === after.mtime) {
        const meta = { hash, size: after.size, mtime: after.mtime };
        this.state.saveHash(file.path, meta);
        return meta;
      }
    }
    return null;
  }

  read(vaultPath: string, range?: ByteRange): Promise<Bytes> {
    const stream = createReadStream(this.abs(vaultPath), range && { start: range.start, end: range.end });
    return Promise.resolve(Readable.toWeb(stream));
  }

  async write(vaultPath: string, content: Bytes, options: WriteOptions): Promise<void> {
    const target = await this.prepare(vaultPath);
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}${TMP_SUFFIX}`);
    const hash = createHash("sha256");
    try {
      await pipeline(toNodeStream(content), hashingStream(hash), createWriteStream(tmp, { flags: "wx" }));
      if (hash.digest("hex") !== options.expectedHash) throw new Error(`${vaultPath}: downloaded bytes do not match`);
      await options.beforeReplace();
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    await utimes(target, options.mtime / MS_PER_SECOND, options.mtime / MS_PER_SECOND);
  }

  async copy(from: string, to: string, mtime: number): Promise<void> {
    const target = await this.prepare(to);
    await copyFile(this.abs(from), target);
    await utimes(target, mtime / MS_PER_SECOND, mtime / MS_PER_SECOND);
  }

  async rename(from: string, to: string): Promise<void> {
    await rename(this.abs(from), await this.prepare(to));
  }

  async remove(vaultPath: string): Promise<void> {
    await rm(this.abs(vaultPath), { force: true });
  }

  private abs(vaultPath: string): string {
    return lexicalTarget(this.root, vaultPath);
  }

  private async prepare(vaultPath: string): Promise<string> {
    const target = this.abs(vaultPath);
    await mkdir(path.dirname(target), { recursive: true });
    await assertInside(this.root, path.dirname(target));
    return target;
  }
}
