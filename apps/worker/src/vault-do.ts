import { DurableObject } from "cloudflare:workers";
import { retryable } from "cloudflare:durable-objects";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
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
  type StatusResponse,
  type TreeEntry,
  type VaultId,
} from "@vault-sync/protocol";
import migrations from "../drizzle/migrations.js";
import * as schema from "./db/schema.js";
import { base64url, hex, sha256Hex, timingSafeEqualHex } from "./crypto.js";
import { SlidingWindowLimiter } from "./rate-limit.js";
import { fail, ok, type RpcResult } from "./result.js";
import { hashesOf, VaultStore } from "./store.js";

const MAX_R2_LOOKUPS_PER_COMMIT = 50;
const RATE_LIMIT_PER_MINUTE = 600;

type Authed<T> = (deviceId: DeviceId, vaultId: VaultId) => RpcResult<T> | Promise<RpcResult<T>>;

/**
 * One instance per vault, addressed with `getByName(vaultId)`.
 *
 * Device methods take the bearer token and verify it in the same call, so each
 * API request is one billable DO request rather than two.
 */
export class VaultDO extends DurableObject<Env> {
  static {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- retryable() tags prototype methods by reference; it never calls them
    retryable(this.prototype.plan, this.prototype.commit, this.prototype.registerBlob);
  }

  private readonly store: VaultStore;
  private readonly limiter = new SlidingWindowLimiter(RATE_LIMIT_PER_MINUTE, 60_000);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = drizzle(ctx.storage, { schema });
    this.store = new VaultStore(db, (fn) => ctx.storage.transactionSync(fn));
    void ctx.blockConcurrencyWhile(async () => {
      await migrate(db, migrations);
    });
  }

  async enroll(vaultId: VaultId, name: string): Promise<EnrollResponse> {
    const deviceId = DeviceId.parse(`dev_${hex(crypto.getRandomValues(new Uint8Array(8)))}`);
    const token = `${TOKEN_PREFIX}.${vaultId}.${deviceId}.${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
    this.store.insertDevice({ id: deviceId, name, tokenHash: await sha256Hex(token), now: Date.now() });
    return { deviceId, token, cursor: Seq.parse(this.store.cursor()) };
  }

  revokeDevice(deviceId: DeviceId): RpcResult<{ revoked: true }> {
    return this.store.revokeDevice(deviceId) ? ok({ revoked: true }) : fail("not_found", "no such device");
  }

  authorize(token: string): Promise<RpcResult<{ deviceId: DeviceId }>> {
    return this.authed(token, (deviceId) => ok({ deviceId }));
  }

  status(token: string): Promise<RpcResult<StatusResponse>> {
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
      if (missing.length > 0) return fail("missing_blobs", "blobs not uploaded", { hashes: missing });

      return ok(this.store.commit(deviceId, req, Date.now()));
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
      return entry ? ok(entry) : fail("not_found", "no such file");
    });
  }

  private async authed<T>(token: string, run: Authed<T>): Promise<RpcResult<T>> {
    const parsed = parseToken(token);
    if (!parsed || parsed.vaultId !== this.ctx.id.name) return fail("unauthorized", "invalid token");

    const device = this.store.findDevice(parsed.deviceId);
    const presented = await sha256Hex(token);
    if (!device || !timingSafeEqualHex(presented, device.tokenHash)) return fail("unauthorized", "invalid token");
    if (device.revoked) return fail("device_revoked", "device has been revoked");
    if (!this.limiter.take(parsed.deviceId)) return fail("rate_limited", "too many requests");

    this.store.touchDevice(parsed.deviceId, Date.now());
    return run(parsed.deviceId, parsed.vaultId);
  }

  /**
   * Blob keys are global, so bytes uploaded through another vault may already
   * be in R2. Registers the ones found and returns those still missing.
   */
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
