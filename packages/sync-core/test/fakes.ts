import {
  ChangeRow,
  CommitConflicts,
  CommitResponse,
  PlanResponse,
  type Change,
  type CommitRequest,
  type PlanRequest,
} from "@vault-sync/protocol";

import { ApiError } from "../src/errors.ts";
import { buildIgnore } from "../src/plan/ignore.ts";
import type {
  Bytes,
  FileMeta,
  FileStat,
  LocalFiles,
  Remote,
  SyncEnvironment,
  SyncStore,
  WriteOptions,
} from "../src/types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function sha(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function toBytes(content: Bytes): Promise<Uint8Array> {
  return new Uint8Array(content instanceof ArrayBuffer ? content : await new Response(content).arrayBuffer());
}

interface Entry {
  bytes: Uint8Array;
  mtime: number;
}

class MemoryFiles implements LocalFiles {
  readonly entries = new Map<string, Entry>();
  private clock = 1_000;
  onWrite: ((path: string) => void) | null = null;

  put(path: string, text: string): void {
    this.clock += 1;
    this.entries.set(path, { bytes: encoder.encode(text), mtime: this.clock });
  }

  text(path: string): string | undefined {
    const entry = this.entries.get(path);
    return entry === undefined ? undefined : decoder.decode(entry.bytes);
  }

  list(): Promise<FileStat[]> {
    return Promise.resolve([...this.entries].map(([path, e]) => ({ path, size: e.bytes.byteLength, mtime: e.mtime })));
  }

  stat(path: string): Promise<FileStat | null> {
    const e = this.entries.get(path);
    return Promise.resolve(e === undefined ? null : { path, size: e.bytes.byteLength, mtime: e.mtime });
  }

  async hash(file: FileStat): Promise<FileMeta | null> {
    const e = this.entries.get(file.path);
    return e === undefined ? null : { hash: await sha(e.bytes), size: e.bytes.byteLength, mtime: e.mtime };
  }

  read(path: string): Promise<Bytes> {
    const e = this.entries.get(path);
    if (e === undefined) return Promise.reject(new Error(`missing ${path}`));
    return Promise.resolve(e.bytes.slice().buffer);
  }

  async write(path: string, content: Bytes, options: WriteOptions): Promise<void> {
    const bytes = await toBytes(content);
    if ((await sha(bytes)) !== options.expectedHash) throw new Error(`hash mismatch for ${path}`);
    this.onWrite?.(path);
    await options.beforeReplace();
    this.entries.set(path, { bytes, mtime: options.mtime });
  }

  copy(from: string, to: string, mtime: number): Promise<void> {
    const e = this.entries.get(from);
    if (e === undefined) return Promise.reject(new Error(`missing ${from}`));
    this.entries.set(to, { bytes: e.bytes, mtime });
    return Promise.resolve();
  }

  rename(from: string, to: string): Promise<void> {
    const e = this.entries.get(from);
    if (e === undefined) return Promise.reject(new Error(`missing ${from}`));
    this.entries.delete(from);
    this.entries.set(to, e);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.entries.delete(path);
    return Promise.resolve();
  }
}

class MemoryStore implements SyncStore {
  private seq = 0;
  private readonly rows = new Map<string, FileMeta>();

  cursor(): number {
    return this.seq;
  }

  synced(): Map<string, FileMeta> {
    return new Map(this.rows);
  }

  applyCommitted(changes: readonly Change[], cursor: number): void {
    for (const c of changes) {
      if (c.op === "delete") this.rows.delete(c.path);
      if (c.op === "rename") this.rows.delete(c.fromPath);
      if (c.op !== "delete") this.rows.set(c.path, { hash: c.hash, size: c.size, mtime: c.mtime });
    }
    this.seq = cursor;
  }

  applyPulled(updates: ReadonlyMap<string, FileMeta | null>, cursor: number): void {
    for (const [path, meta] of updates) {
      if (meta === null) this.rows.delete(path);
      else this.rows.set(path, meta);
    }
    this.seq = Math.max(this.seq, cursor);
  }
}

export class FakeServer {
  readonly blobs = new Map<string, Uint8Array>();
  readonly log: ChangeRow[] = [];
  private readonly tree = new Map<string, FileMeta>();

  remoteFor(deviceId: string): Remote {
    return {
      changes: (since, limit) => Promise.resolve(this.log.filter((r) => r.seq > since).slice(0, limit)),
      plan: (req: PlanRequest) =>
        Promise.resolve(
          PlanResponse.parse({
            cursor: this.cursor(),
            conflicts: [],
            missing: [...new Set(req.changes.flatMap((c) => (c.op === "delete" ? [] : [c.hash])))].filter(
              (h) => !this.blobs.has(h),
            ),
          }),
        ),
      commit: (req: CommitRequest) => this.commit(deviceId, req),
      hasBlob: (hash) => Promise.resolve(this.blobs.has(hash)),
      putBlob: async (hash, content) => {
        this.blobs.set(hash, await toBytes(content));
      },
      createUpload: () => Promise.reject(new Error("not used")),
      uploadPart: () => Promise.reject(new Error("not used")),
      completeUpload: () => Promise.reject(new Error("not used")),
      blobContent: (hash) => {
        const bytes = this.blobs.get(hash);
        if (bytes === undefined)
          return Promise.reject(new ApiError({ status: 404, code: "ERR_NOT_FOUND", message: "gone" }));
        return Promise.resolve(bytes.slice().buffer);
      },
    };
  }

  private cursor() {
    return this.log.length === 0 ? 0 : (this.log.at(-1)?.seq ?? 0);
  }

  private commit(deviceId: string, req: CommitRequest) {
    const stale = req.changes.filter(
      (c) => c.baseHash !== undefined && (this.tree.get(c.path)?.hash ?? null) !== c.baseHash,
    );
    if (stale.length > 0) {
      const details = CommitConflicts.parse({
        conflicts: stale.map((c) => ({
          path: c.path,
          serverSeq: this.cursor(),
          serverHash: this.tree.get(c.path)?.hash ?? null,
        })),
      });
      return Promise.reject(new ApiError({ status: 409, code: "ERR_CONFLICT", message: "stale", details }));
    }
    const seqFrom = this.cursor() + 1;
    for (const c of req.changes) this.apply(deviceId, c);
    return Promise.resolve(
      CommitResponse.parse({
        batchId: req.batchId,
        seqFrom,
        seqTo: this.cursor(),
        cursor: this.cursor(),
        replayed: false,
      }),
    );
  }

  private apply(deviceId: string, c: Change): void {
    const seq = this.cursor() + 1;
    if (c.op === "rename") this.tree.delete(c.fromPath);
    if (c.op === "delete") this.tree.delete(c.path);
    else this.tree.set(c.path, { hash: c.hash, size: c.size, mtime: c.mtime });
    this.log.push(
      ChangeRow.parse({
        seq,
        op: c.op,
        path: c.path,
        fromPath: c.op === "rename" ? c.fromPath : null,
        hash: c.op === "delete" ? null : c.hash,
        prevHash: null,
        size: c.op === "delete" ? null : c.size,
        mtime: c.op === "delete" ? null : c.mtime,
        deviceId,
        at: 1_700_000_000_000,
      }),
    );
  }
}

export interface Device {
  readonly files: MemoryFiles;
  readonly store: MemoryStore;
  readonly env: SyncEnvironment;
}

export function device(server: FakeServer, id: string, overrides: Partial<SyncEnvironment> = {}): Device {
  const files = new MemoryFiles();
  const store = new MemoryStore();
  const env: SyncEnvironment = {
    files,
    store,
    remote: server.remoteFor(id),
    isIgnored: buildIgnore(),
    device: id,
    caseInsensitive: false,
    unsafePath: () => false,
    now: () => new Date(2026, 10, 17, 9, 5),
    ...overrides,
  };
  return { files, store, env };
}
