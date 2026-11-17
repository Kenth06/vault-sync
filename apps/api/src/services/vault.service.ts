import {
  blobKey,
  SnapshotManifest,
  type ChangeRow,
  type ChangesQuery,
  type CommitRequest,
  type CommitResponse,
  type DeviceSummary,
  type HistoryQuery,
  type PlanRequest,
  type PlanResponse,
  type SnapshotInfo,
  type TreeEntry,
  type TreeResponse,
  type VaultPath,
  type VaultStatus,
} from "@vault-sync/protocol";

import { AppError } from "../common/errors.ts";
import type { DeviceAuth } from "../common/types/context.ts";
import { gunzipJson } from "../utils/gzip.ts";
import { BaseService } from "./base.service.ts";

export interface FileContent {
  readonly entry: TreeEntry;
  readonly body: ReadableStream;
  readonly size: number;
}

export class VaultService extends BaseService {
  async status(auth: DeviceAuth): Promise<VaultStatus> {
    return this.unwrap(await this.vault(auth.vaultId).status(auth.token));
  }

  async devices(auth: DeviceAuth): Promise<DeviceSummary[]> {
    return this.unwrap(await this.vault(auth.vaultId).deviceSummaries(auth.token));
  }

  async revokeSelf(auth: DeviceAuth): Promise<void> {
    this.unwrap(await this.vault(auth.vaultId).revokeSelf(auth.token));
  }

  async plan(auth: DeviceAuth, req: PlanRequest): Promise<PlanResponse> {
    return this.unwrap(await this.vault(auth.vaultId).plan(auth.token, req));
  }

  async commit(auth: DeviceAuth, req: CommitRequest): Promise<CommitResponse> {
    return this.unwrap(await this.vault(auth.vaultId).commit(auth.token, req));
  }

  async changes(auth: DeviceAuth, query: ChangesQuery): Promise<ChangeRow[]> {
    return this.unwrap(await this.vault(auth.vaultId).listChanges(auth.token, query.since, query.limit));
  }

  async history(auth: DeviceAuth, query: HistoryQuery): Promise<ChangeRow[]> {
    return this.unwrap(await this.vault(auth.vaultId).history(auth.token, query.path, query.limit));
  }

  async tree(auth: DeviceAuth, at: number | undefined): Promise<TreeResponse> {
    return this.unwrap(await this.vault(auth.vaultId).tree(auth.token, at));
  }

  async readFile(auth: DeviceAuth, path: VaultPath): Promise<FileContent> {
    const entry = this.unwrap(await this.vault(auth.vaultId).getFile(auth.token, path));
    const object = await this.bucket.get(blobKey(auth.vaultId, entry.hash));
    if (!object) throw new AppError("ERR_INTERNAL", "manifest points at a blob missing from R2");
    return { entry, body: object.body, size: object.size };
  }

  connect(auth: DeviceAuth, request: Request): Promise<Response> {
    return this.vault(auth.vaultId).fetch(request);
  }

  async snapshots(auth: DeviceAuth): Promise<SnapshotInfo[]> {
    return this.unwrap(await this.vault(auth.vaultId).listSnapshots(auth.token));
  }

  async createSnapshot(auth: DeviceAuth): Promise<SnapshotInfo | null> {
    return this.unwrap(await this.vault(auth.vaultId).createSnapshot(auth.token));
  }

  async snapshotTree(auth: DeviceAuth, seq: number): Promise<TreeResponse> {
    const record = this.unwrap(await this.vault(auth.vaultId).findSnapshot(auth.token, seq));
    const object = await this.bucket.get(record.r2Key);
    if (!object) throw new AppError("ERR_INTERNAL", "snapshot index points at a missing R2 object");
    const manifest = SnapshotManifest.parse(await gunzipJson(object.body));
    return { seq: manifest.seq, files: manifest.files };
  }
}
