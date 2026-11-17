import { z } from "zod";

import { MAX_MULTIPART_PARTS } from "./limits.ts";

export const BlobStored = z.object({
  stored: z.boolean(),
  size: z.number().int().nonnegative(),
});
export type BlobStored = z.infer<typeof BlobStored>;

export const CreateUploadResponse = z.object({ uploadId: z.string().min(1) });
export type CreateUploadResponse = z.infer<typeof CreateUploadResponse>;

export const UploadedPart = z.object({
  partNumber: z.number().int().min(1).max(MAX_MULTIPART_PARTS),
  etag: z.string().min(1),
});
export type UploadedPart = z.infer<typeof UploadedPart>;

export const CompleteUploadRequest = z.object({
  size: z.number().int().nonnegative(),
  parts: z.array(UploadedPart).min(1).max(MAX_MULTIPART_PARTS),
});
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequest>;
