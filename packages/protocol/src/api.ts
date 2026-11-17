import { z } from "zod";
import { BatchId, DeviceId, Seq, Sha256, VaultId } from "./ids.js";
import { VaultPath } from "./path.js";

/** Largest body sent in a single PUT. Zones on Free/Pro reject request bodies over 100 MB. */
export const SINGLE_PUT_MAX_BYTES = 90 * 1024 * 1024;
/** Multipart part size used by the client (R2 allows 5 MiB – 5 GiB per part). */
export const MULTIPART_PART_BYTES = 32 * 1024 * 1024;
export const MAX_BATCH_CHANGES = 500;

// ---------- changes ----------

const Mtime = z.number().int().nonnegative();
const Size = z.number().int().nonnegative();

export const PutChange = z.object({
  op: z.literal("put"),
  path: VaultPath,
  hash: Sha256,
  size: Size,
  mtime: Mtime,
});

export type PutChange = z.infer<typeof PutChange>;

export const DeleteChange = z.object({
  op: z.literal("delete"),
  path: VaultPath,
});

/** Same bytes moved from `fromPath` to `path` inside one batch. */
export const RenameChange = z.object({
  op: z.literal("rename"),
  path: VaultPath,
  fromPath: VaultPath,
  hash: Sha256,
  size: Size,
  mtime: Mtime,
});

export const Change = z.discriminatedUnion("op", [PutChange, DeleteChange, RenameChange]);
export type Change = z.infer<typeof Change>;

const Changes = z.array(Change).min(1).max(MAX_BATCH_CHANGES);

// ---------- enroll ----------

export const EnrollRequest = z.object({
  vaultId: VaultId,
  name: z.string().min(1).max(100),
});
export type EnrollRequest = z.infer<typeof EnrollRequest>;

export const EnrollResponse = z.object({
  deviceId: DeviceId,
  token: z.string(),
  cursor: Seq,
});
export type EnrollResponse = z.infer<typeof EnrollResponse>;

// ---------- plan ----------

export const PlanRequest = z.object({
  baseCursor: Seq,
  changes: Changes,
});
export type PlanRequest = z.infer<typeof PlanRequest>;

export const Conflict = z.object({
  path: VaultPath,
  serverSeq: Seq,
  serverHash: Sha256.nullable(),
});
export type Conflict = z.infer<typeof Conflict>;

export const PlanResponse = z.object({
  cursor: Seq,
  missing: z.array(Sha256),
  conflicts: z.array(Conflict),
});
export type PlanResponse = z.infer<typeof PlanResponse>;

// ---------- commit ----------

export const CommitRequest = z.object({
  batchId: BatchId,
  baseCursor: Seq,
  changes: Changes,
});
export type CommitRequest = z.infer<typeof CommitRequest>;

export const CommitResponse = z.object({
  batchId: BatchId,
  seqFrom: Seq.nullable(),
  seqTo: Seq.nullable(),
  cursor: Seq,
  /** true when the batchId was already committed and this is the stored result. */
  replayed: z.boolean(),
});
export type CommitResponse = z.infer<typeof CommitResponse>;

// ---------- multipart ----------

export const CreateUploadResponse = z.object({ uploadId: z.string().min(1) });

export const UploadedPart = z.object({
  partNumber: z.number().int().min(1).max(10_000),
  etag: z.string().min(1),
});
export type UploadedPart = z.infer<typeof UploadedPart>;

export const CompleteUploadRequest = z.object({
  size: Size,
  parts: z.array(UploadedPart).min(1).max(10_000),
});

// ---------- read side ----------

export const ChangesQuery = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const ChangeRow = z.object({
  seq: Seq,
  op: z.enum(["put", "delete", "rename"]),
  path: z.string(),
  fromPath: z.string().nullable(),
  hash: Sha256.nullable(),
  prevHash: Sha256.nullable(),
  deviceId: DeviceId,
  at: z.number().int(),
});
export type ChangeRow = z.infer<typeof ChangeRow>;

export const TreeEntry = z.object({
  path: z.string(),
  hash: Sha256,
  size: Size,
  mtime: Mtime,
});
export type TreeEntry = z.infer<typeof TreeEntry>;

export const StatusResponse = z.object({
  vaultId: VaultId,
  cursor: Seq,
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  deviceCursor: Seq,
});
export type StatusResponse = z.infer<typeof StatusResponse>;

// ---------- errors ----------

export const ErrorCode = z.enum([
  "unauthorized",
  "forbidden",
  "bad_request",
  "not_found",
  "missing_blobs",
  "checksum_mismatch",
  "device_revoked",
  "vault_mismatch",
  "rate_limited",
  "payload_too_large",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;
