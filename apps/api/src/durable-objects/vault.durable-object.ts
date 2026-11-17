import {
  blobKey,
  DeviceId,
  parseToken,
  Seq,
  TOKEN_PREFIX,
  type ChangeRow,
  type CommitRequest,
  type CommitResponse,
  type EnrollResponse,
  type PlanRequest,
  type PlanResponse,
  type Sha256,
  type TreeEntry,
  type VaultId,
  type VaultStatus,
} from "@vault-sync/protocol";
import { retryable } from "cloudflare:durable-objects";
import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import migrations from "../../drizzle/migrations/migrations.js";
import { MAX_R2_LOOKUPS_PER_COMMIT, RATE_LIMIT_PER_MINUTE, RATE_LIMIT_WINDOW_MS } from "../common/constants.ts";
import * as schema from "../entities/index.ts";
import { randomBase64Url, randomHex, sha256Hex, timingSafeEqualHex } from "../utils/crypto.ts";
import { SlidingWindowLimiter } from "../utils/rate-limiter.ts";
import { fail, ok, type RpcResult } from "../utils/rpc-result.ts";
import { hashesOf, VaultStore } from "./vault.store.ts";

type Authed<T> = (deviceId: DeviceId, vaultId: VaultId) => RpcResult<T> | Promise<RpcResult<T>>;

export class VaultDO extends DurableObject<Env> {
  static {
    // oxlint-disable-next-line typescript/unbound-method
    retryable(this.prototype.plan, this.prototype.commit, this.prototype.registerBlob, this.prototype.claimBlob);
  }

  private readonly store: VaultStore;
  private readonly limiter = new SlidingWindowLimiter(RATE_LIMIT_PER_MINUTE, RATE_LIMIT_WINDOW_MS);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = drizzle(ctx.storage, { schema });
    this.store = new VaultStore(db, (fn) => ctx.storage.transactionSync(fn));
    void ctx.blockConcurrencyWhile(async () => {
      await migrate(db, migrations);
    });
  }

  async enroll(vaultId: VaultId, name: string): Promise<EnrollResponse> {
    const deviceId = DeviceId.parse(`dev_${randomHex(8)}`);
    const token = `${TOKEN_PREFIX}.${vaultId}.${deviceId}.${randomBase64Url(32)}`;
    this.store.insertDevice({ id: deviceId, name, tokenHash: await sha256Hex(token), now: Date.now() });
    return { deviceId, token, cursor: Seq.parse(this.store.cursor()) };
  }

  revokeDevice(deviceId: DeviceId): RpcResult<{ revoked: true }> {
    return this.store.revokeDevice(deviceId) ? ok({ revoked: true }) : fail("ERR_NOT_FOUND", "no such device");
  }

  authorize(token: string): Promise<RpcResult<{ deviceId: DeviceId }>> {
    return this.authed(token, (deviceId) => ok({ deviceId }));
  }

  status(token: string): Promise<RpcResult<VaultStatus>> {
    return this.authed(token, (deviceId, vaultId) =>
      ok({
        vaultId,
        cursor: Seq.parse(this.store.cursor()),
        ...this.store.totals(),
        deviceCursor: Seq.parse(this.store.findDevice(deviceId)?.cursor ?? 0),
      }),
    );
  }

  plan(token: string, req: PlanRequest): Promise<RpcResult<PlanResponse>> {
    return this.authed(token, (deviceId) => ok(this.store.plan(deviceId, req)));
  }

  commit(token: string, req: CommitRequest): Promise<RpcResult<CommitResponse>> {
    return this.authed(token, async (deviceId) => {
      const replay = this.store.findBatch(req.batchId);
      if (replay) return ok(replay);

      const missing = await this.registerFromR2(hashesOf(req.changes));
      if (missing.length > 0) return fail("ERR_CONFLICT", "blobs not uploaded", { missing });

      return ok(this.store.commit(deviceId, req, Date.now()));
    });
  }

  claimBlob(token: string, hash: Sha256): Promise<RpcResult<boolean>> {
    return this.authed(token, async () => {
      if (this.store.unknownHashes([hash]).length === 0) return ok(true);
      const head = await this.env.BUCKET.head(blobKey(hash));
      if (head) this.store.registerBlob(hash, head.size, Date.now());
      return ok(head !== null);
    });
  }

  registerBlob(token: string, hash: Sha256, size: number): Promise<RpcResult<null>> {
    return this.authed(token, () => {
      this.store.registerBlob(hash, size, Date.now());
      return ok(null);
    });
  }

  listChanges(token: string, since: number, limit: number): Promise<RpcResult<ChangeRow[]>> {
    return this.authed(token, () => ok(this.store.listChanges(since, limit)));
  }

  tree(token: string): Promise<RpcResult<TreeEntry[]>> {
    return this.authed(token, () => ok(this.store.tree()));
  }

  getFile(token: string, path: string): Promise<RpcResult<TreeEntry>> {
    return this.authed(token, () => {
      const entry = this.store.getFile(path);
      return entry ? ok(entry) : fail("ERR_NOT_FOUND", "no such file");
    });
  }

  private async authed<T>(token: string, run: Authed<T>): Promise<RpcResult<T>> {
    const parsed = parseToken(token);
    if (!parsed || parsed.vaultId !== this.ctx.id.name) return fail("ERR_UNAUTHORIZED", "invalid token");

    const device = this.store.findDevice(parsed.deviceId);
    const presented = await sha256Hex(token);
    if (!device || !timingSafeEqualHex(presented, device.tokenHash)) return fail("ERR_UNAUTHORIZED", "invalid token");
    if (device.revoked) return fail("ERR_FORBIDDEN", "device has been revoked");
    if (!this.limiter.take(parsed.deviceId)) return fail("ERR_RATE_LIMITED", "too many requests");

    this.store.touchDevice(parsed.deviceId, Date.now());
    return run(parsed.deviceId, parsed.vaultId);
  }

  private async registerFromR2(hashes: Sha256[]): Promise<Sha256[]> {
    const unknown = this.store.unknownHashes(hashes);
    if (unknown.length === 0 || unknown.length > MAX_R2_LOOKUPS_PER_COMMIT) return unknown;

    const heads = await Promise.all(unknown.map((h) => this.env.BUCKET.head(blobKey(h))));
    const now = Date.now();
    return unknown.filter((hash, i) => {
      const head = heads[i];
      if (head) this.store.registerBlob(hash, head.size, now);
      return !head;
    });
  }
}
