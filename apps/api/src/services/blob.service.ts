import { blobKey, type BlobStored, type Sha256, type UploadedPart } from "@vault-sync/protocol";

import { AppError } from "../common/errors.ts";
import type { DeviceAuth } from "../common/types/context.ts";
import { BaseService } from "./base.service.ts";

const CHECKSUM_FAILURE = /sha-?256|checksum|digest/iu;

export interface BlobUpload {
  readonly hash: Sha256;
  readonly body: ReadableStream;
  readonly size: number;
}

export interface PartUpload extends BlobUpload {
  readonly uploadId: string;
  readonly part: number;
}

export interface UploadCompletion {
  readonly hash: Sha256;
  readonly uploadId: string;
  readonly size: number;
  readonly parts: UploadedPart[];
}

export class BlobService extends BaseService {
  async exists(auth: DeviceAuth, hash: Sha256): Promise<boolean> {
    return this.unwrap(await this.vault(auth.vaultId).claimBlob(auth.token, hash));
  }

  async store(auth: DeviceAuth, upload: BlobUpload): Promise<BlobStored> {
    if (await this.exists(auth, upload.hash)) {
      return { stored: false, size: upload.size };
    }
    const object = await this.putVerified(upload);
    await this.register(auth, upload.hash, object.size);
    return { stored: true, size: object.size };
  }

  async createUpload(auth: DeviceAuth, hash: Sha256): Promise<string> {
    if (await this.exists(auth, hash)) throw new AppError("ERR_CONFLICT", "blob already stored");
    return (await this.bucket.createMultipartUpload(blobKey(hash))).uploadId;
  }

  async uploadPart(auth: DeviceAuth, upload: PartUpload): Promise<UploadedPart> {
    await this.authorize(auth);
    const multipart = this.bucket.resumeMultipartUpload(blobKey(upload.hash), upload.uploadId);
    const { partNumber, etag } = await multipart.uploadPart(upload.part, upload.body);
    return { partNumber, etag };
  }

  async completeUpload(auth: DeviceAuth, completion: UploadCompletion): Promise<BlobStored> {
    const multipart = this.bucket.resumeMultipartUpload(blobKey(completion.hash), completion.uploadId);
    if (await this.exists(auth, completion.hash)) {
      await multipart.abort();
      return { stored: false, size: completion.size };
    }
    const object = await multipart.complete(completion.parts);
    if (object.size !== completion.size) {
      await this.bucket.delete(object.key);
      throw new AppError("ERR_BAD_REQUEST", `expected ${completion.size} bytes, got ${object.size}`);
    }
    await this.register(auth, completion.hash, object.size);
    return { stored: true, size: object.size };
  }

  private async putVerified(upload: BlobUpload): Promise<R2Object> {
    try {
      return await this.bucket.put(blobKey(upload.hash), upload.body, {
        sha256: upload.hash,
        customMetadata: { size: String(upload.size) },
      });
    } catch (error) {
      if (CHECKSUM_FAILURE.test(String(error))) {
        throw new AppError("ERR_BAD_REQUEST", "body does not match its sha256");
      }
      throw error;
    }
  }

  private async authorize(auth: DeviceAuth): Promise<void> {
    this.unwrap(await this.vault(auth.vaultId).authorize(auth.token));
  }

  private async register(auth: DeviceAuth, hash: Sha256, size: number): Promise<void> {
    this.unwrap(await this.vault(auth.vaultId).registerBlob(auth.token, hash, size));
  }
}
