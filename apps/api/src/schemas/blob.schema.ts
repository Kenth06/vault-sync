import { MAX_MULTIPART_PARTS, Sha256 } from "@vault-sync/protocol";
import { z } from "zod";

export const blobParamSchema = z.object({ sha256: Sha256 });

export const uploadParamSchema = blobParamSchema.extend({ uploadId: z.string().min(1) });

export const partParamSchema = uploadParamSchema.extend({
  part: z.coerce.number().int().min(1).max(MAX_MULTIPART_PARTS),
});

export const contentLengthSchema = z.object({
  "content-length": z.coerce.number().int().nonnegative(),
});
