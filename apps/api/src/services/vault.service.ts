import {
  blobKey,
  type ChangeRow,
  type ChangesQuery,
  type CommitRequest,
  type CommitResponse,
  type PlanRequest,
  type PlanResponse,
  type TreeEntry,
  type VaultPath,
  type VaultStatus,
} from "@vault-sync/protocol";

import { AppError } from "../common/errors.ts";
import type { DeviceAuth } from "../common/types/context.ts";
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

  async plan(auth: DeviceAuth, req: PlanRequest): Promise<PlanResponse> {
    return this.unwrap(await this.vault(auth.vaultId).plan(auth.token, req));
  }

  async commit(auth: DeviceAuth, req: CommitRequest): Promise<CommitResponse> {
    return this.unwrap(await this.vault(auth.vaultId).commit(auth.token, req));
  }

  async changes(auth: DeviceAuth, query: ChangesQuery): Promise<ChangeRow[]> {
    return this.unwrap(await this.vault(auth.vaultId).listChanges(auth.token, query.since, query.limit));
  }

  async tree(auth: DeviceAuth): Promise<TreeEntry[]> {
    return this.unwrap(await this.vault(auth.vaultId).tree(auth.token));
  }

  async readFile(auth: DeviceAuth, path: VaultPath): Promise<FileContent> {
    const entry = this.unwrap(await this.vault(auth.vaultId).getFile(auth.token, path));
    const object = await this.bucket.get(blobKey(entry.hash));
    if (!object) throw new AppError("ERR_INTERNAL", "manifest points at a blob missing from R2");
    return { entry, body: object.body, size: object.size };
  }
}
