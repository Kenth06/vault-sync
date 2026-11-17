import {
  BlobStored,
  CommitResponse,
  CreateUploadResponse,
  EnrollResponse,
  parseData,
  PlanResponse,
  UploadedPart,
  VaultStatus,
  type CommitRequest,
  type CompleteUploadRequest,
  type EnrollRequest,
  type PlanRequest,
  type VaultId,
} from "@vault-sync/protocol";
import type { z } from "zod";

import { HTTP_BASE_DELAY_MS, HTTP_MAX_ATTEMPTS } from "../common/constants.ts";
import { ApiError } from "../common/errors.ts";

type Body = { json: unknown } | { stream: ReadableStream<Uint8Array>; size: number } | undefined;

export interface PartRequest {
  readonly uploadId: string;
  readonly number: number;
  readonly stream: ReadableStream<Uint8Array>;
  readonly size: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof ApiError) || !error.retryable || attempt >= HTTP_MAX_ATTEMPTS) throw error;
      await delay(HTTP_BASE_DELAY_MS * 2 ** (attempt - 1) * (0.5 + Math.random()));
    }
  }
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
    return withRetry(() => this.send("POST", `/v1/vaults/${vaultId}/plan`, PlanResponse, { json: req }));
  }

  commit(vaultId: VaultId, req: CommitRequest): Promise<CommitResponse> {
    return withRetry(() => this.send("POST", `/v1/vaults/${vaultId}/commit`, CommitResponse, { json: req }));
  }

  async hasBlob(hash: string): Promise<boolean> {
    const res = await this.raw("HEAD", `/v1/blobs/${hash}`);
    if (res.status === 200 || res.status === 404) return res.status === 200;
    throw await ApiError.fromResponse(res);
  }

  putBlob(hash: string, stream: ReadableStream<Uint8Array>, size: number): Promise<BlobStored> {
    return this.send("PUT", `/v1/blobs/${hash}`, BlobStored, { stream, size });
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
