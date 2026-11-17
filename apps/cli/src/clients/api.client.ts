import {
  BlobStored,
  ChangeRow,
  CommitResponse,
  CreateUploadResponse,
  DeviceInfo,
  EnrollResponse,
  parseData,
  PlanResponse,
  SnapshotInfo,
  TreeResponse,
  UploadedPart,
  VaultStatus,
  type CommitRequest,
  type CompleteUploadRequest,
  type DeviceId,
  type EnrollRequest,
  type PlanRequest,
  type VaultId,
} from "@vault-sync/protocol";
import { ApiError, withRetry, type Bytes } from "@vault-sync/sync-core";
import { z } from "zod";

type Body = { json: unknown } | { stream: Bytes; size: number } | undefined;

export interface PartRequest {
  readonly uploadId: string;
  readonly number: number;
  readonly stream: Bytes;
  readonly size: number;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  static enroll(baseUrl: string, adminSecret: string, req: EnrollRequest): Promise<EnrollResponse> {
    return new ApiClient(baseUrl, adminSecret).send("POST", "/v1/devices/enroll", EnrollResponse, { json: req });
  }

  status(vaultId: VaultId): Promise<VaultStatus> {
    return withRetry(() => this.send("GET", `/v1/vaults/${vaultId}/status`, VaultStatus));
  }

  plan(vaultId: VaultId, req: PlanRequest): Promise<PlanResponse> {
    return this.send("POST", `/v1/vaults/${vaultId}/plan`, PlanResponse, { json: req });
  }

  commit(vaultId: VaultId, req: CommitRequest): Promise<CommitResponse> {
    return this.send("POST", `/v1/vaults/${vaultId}/commit`, CommitResponse, { json: req });
  }

  async hasBlob(hash: string): Promise<boolean> {
    const res = await this.raw("HEAD", `/v1/blobs/${hash}`);
    if (res.status === 200 || res.status === 404) return res.status === 200;
    throw await ApiError.fromResponse(res);
  }

  putBlob(hash: string, stream: Bytes, size: number): Promise<BlobStored> {
    return this.send("PUT", `/v1/blobs/${hash}`, BlobStored, { stream, size });
  }

  tree(vaultId: VaultId, at?: number): Promise<TreeResponse> {
    const query = at === undefined ? "" : `?at=${at}`;
    return withRetry(() => this.send("GET", `/v1/vaults/${vaultId}/tree${query}`, TreeResponse));
  }

  changes(vaultId: VaultId, since: number, limit: number): Promise<ChangeRow[]> {
    const url = `/v1/vaults/${vaultId}/changes?since=${since}&limit=${limit}`;
    return this.send("GET", url, ChangeRow.array());
  }

  history(vaultId: VaultId, path: string): Promise<ChangeRow[]> {
    const url = `/v1/vaults/${vaultId}/history?path=${encodeURIComponent(path)}`;
    return withRetry(() => this.send("GET", url, ChangeRow.array()));
  }

  snapshots(vaultId: VaultId): Promise<SnapshotInfo[]> {
    return withRetry(() => this.send("GET", `/v1/vaults/${vaultId}/snapshots`, SnapshotInfo.array()));
  }

  createSnapshot(vaultId: VaultId): Promise<SnapshotInfo | null> {
    return this.send("POST", `/v1/vaults/${vaultId}/snapshots`, SnapshotInfo.nullable());
  }

  snapshotTree(vaultId: VaultId, seq: number): Promise<TreeResponse> {
    return withRetry(() => this.send("GET", `/v1/vaults/${vaultId}/snapshots/${seq}`, TreeResponse));
  }

  async blobContent(hash: string): Promise<ReadableStream<Uint8Array>> {
    const res = await this.raw("GET", `/v1/blobs/${hash}/content`);
    if (!res.ok || res.body === null) throw await ApiError.fromResponse(res);
    return res.body;
  }

  devices(vaultId: VaultId): Promise<DeviceInfo[]> {
    return this.send("GET", `/v1/devices?vaultId=${vaultId}`, DeviceInfo.array());
  }

  revokeDevice(vaultId: VaultId, deviceId: DeviceId): Promise<unknown> {
    return this.send("POST", `/v1/devices/${deviceId}/revoke`, z.unknown(), { json: { vaultId } });
  }

  async createUpload(hash: string): Promise<string> {
    return (await this.send("POST", `/v1/blobs/${hash}/uploads`, CreateUploadResponse)).uploadId;
  }

  uploadPart(hash: string, part: PartRequest): Promise<UploadedPart> {
    const url = `/v1/blobs/${hash}/uploads/${encodeURIComponent(part.uploadId)}/${part.number}`;
    return this.send("PUT", url, UploadedPart, { stream: part.stream, size: part.size });
  }

  completeUpload(hash: string, uploadId: string, body: CompleteUploadRequest): Promise<BlobStored> {
    const url = `/v1/blobs/${hash}/uploads/${encodeURIComponent(uploadId)}/complete`;
    return this.send("POST", url, BlobStored, { json: body });
  }

  private async send<S extends z.ZodType>(method: string, url: string, schema: S, body?: Body): Promise<z.infer<S>> {
    const res = await this.raw(method, url, body);
    if (!res.ok) throw await ApiError.fromResponse(res);
    return parseData(schema, await res.json());
  }

  private async raw(method: string, url: string, body?: Body): Promise<Response> {
    const headers = new Headers({ Authorization: `Bearer ${this.token}` });
    const init: RequestInit & { duplex?: "half" } = { method, headers };
    if (body && "json" in body) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(body.json);
    } else if (body) {
      headers.set("Content-Length", String(body.size));
      init.body = body.stream;
      init.duplex = "half";
    }
    try {
      return await fetch(new URL(url, this.baseUrl), init);
    } catch (error) {
      throw new ApiError({ status: 0, code: "ERR_NETWORK", message: String(error) });
    }
  }
}
