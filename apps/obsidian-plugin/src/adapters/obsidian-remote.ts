import {
  BlobStored,
  ChangeRow,
  CommitResponse,
  CreateUploadResponse,
  EnrollResponse,
  ErrorBody,
  parseData,
  PlanResponse,
  UploadedPart,
  VaultStatus,
  type CommitRequest,
  type CompleteUploadRequest,
  type EnrollRequest,
  type PlanRequest,
} from "@vault-sync/protocol";
import { ApiError, type Bytes, type PartUpload, type Remote } from "@vault-sync/sync-core";
import type { z } from "zod";

import { toArrayBuffer } from "./bytes.ts";

export interface HttpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string | ArrayBuffer;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly arrayBuffer: ArrayBuffer;
  readonly text: string;
}

export type HttpFn = (request: HttpRequest) => Promise<HttpResponse>;

const OK_MIN = 200;
const OK_MAX = 299;
const NOT_FOUND = 404;
const MS_PER_SECOND = 1000;

function errorFrom(res: HttpResponse): ApiError {
  const retryAfterMs =
    Math.max(0, Number(res.headers["retry-after"] ?? res.headers["Retry-After"] ?? 0)) * MS_PER_SECOND;
  let body: unknown = null;
  try {
    body = JSON.parse(res.text);
  } catch {
    body = null;
  }
  const parsed = ErrorBody.safeParse(body);
  if (!parsed.success)
    return new ApiError({ status: res.status, code: "ERR_UNKNOWN", message: `HTTP ${res.status}`, retryAfterMs });
  return new ApiError({
    status: res.status,
    code: parsed.data.code,
    message: parsed.data.error,
    details: parsed.data.details,
    retryAfterMs,
  });
}

export interface ServerTarget {
  readonly url: string;
  readonly vaultId: string;
  readonly token: string;
}

export class ObsidianRemote implements Remote {
  private readonly http: HttpFn;
  private readonly target: ServerTarget;

  constructor(http: HttpFn, target: ServerTarget) {
    this.http = http;
    this.target = target;
  }

  static enroll(
    http: HttpFn,
    server: { url: string; adminSecret: string },
    req: EnrollRequest,
  ): Promise<EnrollResponse> {
    const remote = new ObsidianRemote(http, { url: server.url, vaultId: req.vaultId, token: server.adminSecret });
    return remote.json("POST", "/v1/devices/enroll", EnrollResponse, req);
  }

  status(): Promise<VaultStatus> {
    return this.json("GET", this.vaultPath("/status"), VaultStatus);
  }

  changes(since: number, limit: number): Promise<ChangeRow[]> {
    return this.json("GET", this.vaultPath(`/changes?since=${since}&limit=${limit}`), ChangeRow.array());
  }

  plan(req: PlanRequest): Promise<PlanResponse> {
    return this.json("POST", this.vaultPath("/plan"), PlanResponse, req);
  }

  commit(req: CommitRequest): Promise<CommitResponse> {
    return this.json("POST", this.vaultPath("/commit"), CommitResponse, req);
  }

  async hasBlob(hash: string): Promise<boolean> {
    const res = await this.send({ method: "GET", path: `/v1/blobs/${hash}` });
    if (res.status === NOT_FOUND) return false;
    if (res.status < OK_MIN || res.status > OK_MAX) throw errorFrom(res);
    return true;
  }

  async putBlob(hash: string, content: Bytes): Promise<void> {
    await this.binary("PUT", `/v1/blobs/${hash}`, BlobStored, content);
  }

  async createUpload(hash: string): Promise<string> {
    return (await this.json("POST", `/v1/blobs/${hash}/uploads`, CreateUploadResponse)).uploadId;
  }

  uploadPart(hash: string, part: PartUpload): Promise<UploadedPart> {
    return this.binary(
      "PUT",
      `/v1/blobs/${hash}/uploads/${encodeURIComponent(part.uploadId)}/${part.number}`,
      UploadedPart,
      part.content,
    );
  }

  async completeUpload(hash: string, uploadId: string, body: CompleteUploadRequest): Promise<void> {
    await this.json("POST", `/v1/blobs/${hash}/uploads/${encodeURIComponent(uploadId)}/complete`, BlobStored, body);
  }

  async blobContent(hash: string): Promise<Bytes> {
    const res = await this.send({ method: "GET", path: `/v1/blobs/${hash}/content` });
    if (res.status < OK_MIN || res.status > OK_MAX) throw errorFrom(res);
    return res.arrayBuffer;
  }

  private vaultPath(suffix: string): string {
    return `/v1/vaults/${this.target.vaultId}${suffix}`;
  }

  private async json<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const res = await this.send({ method, path, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (res.status < OK_MIN || res.status > OK_MAX) throw errorFrom(res);
    return parseData(schema, JSON.parse(res.text));
  }

  private async binary<S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    content: Bytes,
  ): Promise<z.infer<S>> {
    const res = await this.send({ method, path, body: await toArrayBuffer(content), binary: true });
    if (res.status < OK_MIN || res.status > OK_MAX) throw errorFrom(res);
    return parseData(schema, JSON.parse(res.text));
  }

  private async send(req: {
    method: string;
    path: string;
    body?: string | ArrayBuffer;
    binary?: boolean;
  }): Promise<HttpResponse> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.target.token}` };
    if (req.body !== undefined)
      headers["Content-Type"] = req.binary === true ? "application/octet-stream" : "application/json";
    try {
      const url = new URL(req.path, this.target.url).toString();
      return await this.http({
        url,
        method: req.method,
        headers,
        ...(req.body === undefined ? {} : { body: req.body }),
      });
    } catch (error) {
      throw new ApiError({ status: 0, code: "ERR_NETWORK", message: String(error) });
    }
  }
}
