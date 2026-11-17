import type {
  Change,
  ChangeRow,
  CommitRequest,
  CommitResponse,
  CompleteUploadRequest,
  PlanRequest,
  PlanResponse,
  UploadedPart,
} from "@vault-sync/protocol";

export interface FileMeta {
  readonly hash: string;
  readonly size: number;
  readonly mtime: number;
}

export interface FileStat {
  readonly path: string;
  readonly size: number;
  readonly mtime: number;
}

export interface LocalFile extends FileMeta {
  readonly path: string;
}

export type Bytes = ReadableStream<Uint8Array> | ArrayBuffer;

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

export interface WriteOptions {
  readonly expectedHash: string;
  readonly mtime: number;
  readonly beforeReplace: () => Promise<void>;
}

export interface LocalFiles {
  list(): Promise<FileStat[]>;
  stat(path: string): Promise<FileStat | null>;
  hash(file: FileStat): Promise<FileMeta | null>;
  read(path: string, range?: ByteRange): Promise<Bytes>;
  write(path: string, content: Bytes, options: WriteOptions): Promise<void>;
  copy(from: string, to: string, mtime: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface PartUpload {
  readonly uploadId: string;
  readonly number: number;
  readonly content: Bytes;
  readonly size: number;
}

export interface Remote {
  changes(since: number, limit: number): Promise<ChangeRow[]>;
  plan(req: PlanRequest): Promise<PlanResponse>;
  commit(req: CommitRequest): Promise<CommitResponse>;
  hasBlob(hash: string): Promise<boolean>;
  putBlob(hash: string, content: Bytes, size: number): Promise<void>;
  createUpload(hash: string): Promise<string>;
  uploadPart(hash: string, part: PartUpload): Promise<UploadedPart>;
  completeUpload(hash: string, uploadId: string, body: CompleteUploadRequest): Promise<void>;
  blobContent(hash: string): Promise<Bytes>;
}

export interface SyncStore {
  cursor(): number;
  synced(): Map<string, FileMeta>;
  applyCommitted(changes: readonly Change[], cursor: number): void | Promise<void>;
  applyPulled(updates: ReadonlyMap<string, FileMeta | null>, cursor: number): void | Promise<void>;
}

export interface SyncEnvironment {
  readonly files: LocalFiles;
  readonly remote: Remote;
  readonly store: SyncStore;
  readonly isIgnored: (vaultPath: string) => boolean;
  readonly device: string;
  readonly caseInsensitive: boolean;
  readonly unsafePath: (vaultPath: string) => boolean;
  readonly now?: () => Date;
}

export interface PushReport {
  readonly changes: number;
  readonly batches: number;
}

export interface PullReport {
  readonly applied: number;
  readonly conflicts: string[];
  readonly failed: string[];
  readonly cursor: number;
}

export interface SyncReport {
  readonly pulled: number;
  readonly pushed: number;
  readonly batches: number;
  readonly conflicts: string[];
  readonly failed: string[];
  readonly cursor: number;
}
