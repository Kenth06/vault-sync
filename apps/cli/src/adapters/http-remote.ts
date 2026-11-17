import type {
  ChangeRow,
  CommitRequest,
  CommitResponse,
  CompleteUploadRequest,
  PlanRequest,
  PlanResponse,
  UploadedPart,
  VaultId,
} from "@vault-sync/protocol";
import type { Bytes, PartUpload, Remote } from "@vault-sync/sync-core";

import type { ApiClient } from "../clients/api.client.ts";

export class HttpRemote implements Remote {
  private readonly client: ApiClient;
  private readonly vaultId: VaultId;

  constructor(client: ApiClient, vaultId: VaultId) {
    this.client = client;
    this.vaultId = vaultId;
  }

  changes(since: number, limit: number): Promise<ChangeRow[]> {
    return this.client.changes(this.vaultId, since, limit);
  }

  plan(req: PlanRequest): Promise<PlanResponse> {
    return this.client.plan(this.vaultId, req);
  }

  commit(req: CommitRequest): Promise<CommitResponse> {
    return this.client.commit(this.vaultId, req);
  }

  hasBlob(hash: string): Promise<boolean> {
    return this.client.hasBlob(hash);
  }

  async putBlob(hash: string, content: Bytes, size: number): Promise<void> {
    await this.client.putBlob(hash, content, size);
  }

  createUpload(hash: string): Promise<string> {
    return this.client.createUpload(hash);
  }

  uploadPart(hash: string, part: PartUpload): Promise<UploadedPart> {
    return this.client.uploadPart(hash, {
      uploadId: part.uploadId,
      number: part.number,
      stream: part.content,
      size: part.size,
    });
  }

  async completeUpload(hash: string, uploadId: string, body: CompleteUploadRequest): Promise<void> {
    await this.client.completeUpload(hash, uploadId, body);
  }

  blobContent(hash: string): Promise<Bytes> {
    return this.client.blobContent(hash);
  }
}
