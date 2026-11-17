import {
  CommitResponse,
  CreateUploadResponse,
  EnrollResponse,
  PlanResponse,
  StatusResponse,
  UploadedPart,
  type CommitRequest,
  type EnrollRequest,
  type PlanRequest,
} from "@vault-sync/protocol";
import { z } from "zod";
import { ApiError } from "./api-error.ts";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;

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
      if (!(error instanceof ApiError) || !error.retryable || attempt >= MAX_ATTEMPTS) throw error;
      await delay(BASE_DELAY_MS * 2 ** (attempt - 1) * (0.5 + Math.random()));
    }
  }
}

type Body = { json: unknown } | { stream: ReadableStream<Uint8Array>; size: number } | undefined;

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

  status(vaultId: string): Promise<StatusResponse> {
    return withRetry(() => this.send("GET", `/v1/vaults/${vaultId}/status`, StatusResponse));
  }

  plan(vaultId: string, req: PlanRequest): Promise<PlanResponse> {
    return withRetry(() => this.send("POST", `/v1/vaults/${vaultId}/plan`, PlanResponse, { json: req }));
  }

  commit(vaultId: string, req: CommitRequest): Promise<CommitResponse> {
    return withRetry(() => this.send("POST", `/v1/vaults/${vaultId}/commit`, CommitResponse, { json: req }));
  }

  async hasBlob(hash: string): Promise<boolean> {
    const res = await this.raw("HEAD", `/v1/blobs/${hash}`);
    if (res.status === 200 || res.status === 404) return res.status === 200;
    throw await ApiError.fromResponse(res);
  }

  putBlob(hash: string, stream: ReadableStream<Uint8Array>, size: number): Promise<unknown> {
    return this.send("PUT", `/v1/blobs/${hash}`, z.unknown(), { stream, size });
  }

  async createUpload(hash: string): Promise<string> {
    return (await this.send("POST", `/v1/blobs/${hash}/uploads`, CreateUploadResponse)).uploadId;
  }

  uploadPart(hash: string, part: { uploadId: string; number: number; stream: ReadableStream<Uint8Array>; size: number }) {
    const url = `/v1/blobs/${hash}/uploads/${encodeURIComponent(part.uploadId)}/${part.number}`;
    return this.send("PUT", url, UploadedPart, { stream: part.stream, size: part.size });
  }

  completeUpload(hash: string, uploadId: string, body: { size: number; parts: UploadedPart[] }): Promise<unknown> {
    const url = `/v1/blobs/${hash}/uploads/${encodeURIComponent(uploadId)}/complete`;
    return this.send("POST", url, z.unknown(), { json: body });
  }

  private async send<S extends z.ZodType>(method: string, url: string, schema: S, body?: Body): Promise<z.infer<S>> {
    const res = await this.raw(method, url, body);
    if (!res.ok) throw await ApiError.fromResponse(res);
    return schema.parse(await res.json());
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
      throw new ApiError(0, "network", String(error));
    }
  }
}
