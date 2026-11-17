import {
  blobKey,
  DeviceId,
  parseToken,
  Seq,
  TOKEN_PREFIX,
  VaultId,
  type ChangeRow,
  type CommitRequest,
  type CommitResponse,
  type DeviceInfo,
  type DeviceSummary,
  type EnrollResponse,
  type PlanRequest,
  type PlanResponse,
  type Sha256,
  type SnapshotInfo,
  type TreeEntry,
  type TreeResponse,
  type VaultEvent,
  type VaultStatus,
  WS_PING,
  WS_PONG,
  WS_PROTOCOL,
  tokenFromProtocols,
  type ErrorCode,
} from "@vault-sync/protocol";
import { retryable } from "cloudflare:durable-objects";
import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { z } from "zod";

import migrations from "../../drizzle/migrations/migrations.js";
import {
  DEFAULT_GC_GRACE_MS,
  MAX_R2_LOOKUPS_PER_COMMIT,
  RATE_LIMIT_PER_MINUTE,
  RATE_LIMIT_WINDOW_MS,
  SNAPSHOT_INTERVAL_MS,
} from "../common/constants.ts";
import * as schema from "../entities/index.ts";
import { randomBase64Url, randomHex, sha256Hex, timingSafeEqualHex } from "../utils/crypto.ts";
import { SlidingWindowLimiter } from "../utils/rate-limiter.ts";
import { fail, ok, type RpcResult } from "../utils/rpc-result.ts";
import { BlobStore } from "./stores/blob.store.ts";
import { DeviceStore } from "./stores/device.store.ts";
import { hashesOf, ManifestStore } from "./stores/manifest.store.ts";
import { SnapshotStore, type SnapshotRecord } from "./stores/snapshot.store.ts";
import { VaultMaintenance } from "./vault.maintenance.ts";

type Authed<T> = (deviceId: DeviceId) => RpcResult<T> | Promise<RpcResult<T>>;

const WS_CLOSE_REVOKED = 4001;
const WS_CLOSE_POLICY = 1008;
const UPGRADE_STATUS: Partial<Record<ErrorCode, number>> = { ERR_FORBIDDEN: 403, ERR_RATE_LIMITED: 429 };
const RetryDetails = z.object({ retryAfterMs: z.number().nonnegative() });

function upgradeRefused(failure: { code: ErrorCode; message: string; details?: unknown }): Response {
  const retry = RetryDetails.safeParse(failure.details);
  const headers = new Headers();
  if (retry.success) headers.set("Retry-After", String(Math.ceil(retry.data.retryAfterMs / 1000)));
  return new Response(failure.message, { status: UPGRADE_STATUS[failure.code] ?? 401, headers });
}
const WS_CLOSE_GOING_AWAY = 1001;

function gcGraceMs(env: Env): number {
  const parsed = Number(env.GC_GRACE_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_GC_GRACE_MS;
}

export class VaultDO extends DurableObject<Env> {
  static {
    // oxlint-disable-next-line typescript/unbound-method
    retryable(this.prototype.plan, this.prototype.commit, this.prototype.registerBlob, this.prototype.claimBlob);
  }

  private readonly devices: DeviceStore;
  private readonly blobs: BlobStore;
  private readonly snapshots: SnapshotStore;
  private readonly manifest: ManifestStore;
  private readonly limiter = new SlidingWindowLimiter(RATE_LIMIT_PER_MINUTE, RATE_LIMIT_WINDOW_MS);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = drizzle(ctx.storage, { schema });
    this.devices = new DeviceStore(db);
    this.blobs = new BlobStore(db);
    this.snapshots = new SnapshotStore(db);
    this.manifest = new ManifestStore({
      db,
      transactionSync: (fn) => ctx.storage.transactionSync(fn),
      blobs: this.blobs,
      devices: this.devices,
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(WS_PING, WS_PONG));
    void ctx.blockConcurrencyWhile(async () => {
      await migrate(db, migrations);
    });
  }

  private get vaultId(): VaultId {
    return VaultId.parse(this.ctx.id.name);
  }

  async enroll(vaultId: VaultId, name: string): Promise<EnrollResponse> {
    const deviceId = DeviceId.parse(`dev_${randomHex(8)}`);
    const token = `${TOKEN_PREFIX}.${vaultId}.${deviceId}.${randomBase64Url(32)}`;
    const cursor = this.manifest.cursor();
    this.devices.insert({ id: deviceId, name, tokenHash: await sha256Hex(token), cursor, now: Date.now() });
    return { deviceId, token, cursor: Seq.parse(cursor) };
  }

  listDevices(): DeviceInfo[] {
    return this.devices.list();
  }

  revokeDevice(deviceId: DeviceId): RpcResult<{ revoked: true }> {
    if (!this.devices.revoke(deviceId)) return fail("ERR_NOT_FOUND", "no such device");
    for (const ws of this.ctx.getWebSockets(deviceId)) ws.close(WS_CLOSE_REVOKED, "device revoked");
    return ok({ revoked: true });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const token = tokenFromProtocols(request.headers.get("Sec-WebSocket-Protocol")) ?? "";
    const auth = await this.authed(token, (deviceId) => ok(deviceId));
    if (!auth.ok) return upgradeRefused(auth);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [auth.value]);
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": WS_PROTOCOL } });
  }

  override webSocketMessage(ws: WebSocket): void {
    ws.close(WS_CLOSE_POLICY, "clients only send ping");
  }

  private broadcast(event: VaultEvent): void {
    const message = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        ws.close(WS_CLOSE_GOING_AWAY, "send failed");
      }
    }
  }

  authorize(token: string): Promise<RpcResult<{ deviceId: DeviceId }>> {
    return this.authed(token, (deviceId) => ok({ deviceId }));
  }

  status(token: string): Promise<RpcResult<VaultStatus>> {
    return this.authed(token, (deviceId) =>
      ok({
        vaultId: this.vaultId,
        cursor: Seq.parse(this.manifest.cursor()),
        ...this.manifest.totals(),
        deviceCursor: Seq.parse(this.devices.find(deviceId)?.cursor ?? 0),
      }),
    );
  }

  deviceSummaries(token: string): Promise<RpcResult<DeviceSummary[]>> {
    return this.authed(token, () => ok(this.devices.list().map(({ id, name, lastSeen }) => ({ id, name, lastSeen }))));
  }

  revokeSelf(token: string): Promise<RpcResult<{ revoked: true }>> {
    return this.authed(token, (deviceId) => this.revokeDevice(deviceId));
  }

  plan(token: string, req: PlanRequest): Promise<RpcResult<PlanResponse>> {
    return this.authed(token, (deviceId) => ok(this.manifest.plan(deviceId, req)));
  }

  commit(token: string, req: CommitRequest): Promise<RpcResult<CommitResponse>> {
    return this.authed(token, async (deviceId) => {
      const replay = this.manifest.findBatch(req.batchId);
      if (replay) return ok(replay);

      const missing = await this.registerFromR2(hashesOf(req.changes));
      if (missing.length > 0) return fail("ERR_CONFLICT", "blobs not uploaded", { missing });

      const outcome = this.manifest.commit(deviceId, req, Date.now());
      if (!outcome.ok)
        return fail("ERR_CONFLICT", "changed on the server since your base", { conflicts: outcome.conflicts });
      const { result } = outcome;
      if (result.seqTo !== null && !result.replayed) {
        this.broadcast({ type: "changed", cursor: result.cursor, deviceId });
        await this.ensureAlarm(Date.now() + SNAPSHOT_INTERVAL_MS);
      }
      return ok(result);
    });
  }

  claimBlob(token: string, hash: Sha256): Promise<RpcResult<boolean>> {
    return this.authed(token, async () => {
      if (this.blobs.unknown([hash]).length === 0) return ok(true);
      const head = await this.env.BUCKET.head(blobKey(this.vaultId, hash));
      if (head) this.blobs.register(hash, head.size, Date.now());
      return ok(head !== null);
    });
  }

  registerBlob(token: string, hash: Sha256, size: number): Promise<RpcResult<null>> {
    return this.authed(token, () => {
      this.blobs.register(hash, size, Date.now());
      return ok(null);
    });
  }

  listChanges(token: string, since: number, limit: number): Promise<RpcResult<ChangeRow[]>> {
    return this.authed(token, () => ok(this.manifest.listChanges(since, limit)));
  }

  history(token: string, path: string, limit: number): Promise<RpcResult<ChangeRow[]>> {
    return this.authed(token, () => ok(this.manifest.history(path, limit)));
  }

  tree(token: string, at: number | undefined): Promise<RpcResult<TreeResponse>> {
    return this.authed(token, () => {
      const cursor = this.manifest.cursor();
      if (at === undefined || at >= cursor) return ok({ seq: Seq.parse(cursor), files: this.manifest.tree() });
      return ok({ seq: Seq.parse(at), files: this.manifest.treeAt(at) });
    });
  }

  getFile(token: string, path: string): Promise<RpcResult<TreeEntry>> {
    return this.authed(token, () => {
      const entry = this.manifest.getFile(path);
      return entry ? ok(entry) : fail("ERR_NOT_FOUND", "no such file");
    });
  }

  listSnapshots(token: string): Promise<RpcResult<SnapshotInfo[]>> {
    return this.authed(token, () => ok(this.snapshots.list()));
  }

  findSnapshot(token: string, seq: number): Promise<RpcResult<SnapshotRecord>> {
    return this.authed(token, () => {
      const record = this.snapshots.find(seq);
      return record ? ok(record) : fail("ERR_NOT_FOUND", "no such snapshot");
    });
  }

  createSnapshot(token: string): Promise<RpcResult<SnapshotInfo | null>> {
    return this.authed(token, async () => ok(await this.maintenance().snapshotIfChanged(Date.now())));
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + SNAPSHOT_INTERVAL_MS);
    const report = await this.maintenance().run(Date.now());
    console.info(JSON.stringify({ level: "info", event: "vault.maintenance", vaultId: this.vaultId, ...report }));
    if (report.nextRunAt === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(report.nextRunAt);
  }

  private maintenance(): VaultMaintenance {
    return new VaultMaintenance({
      vaultId: this.vaultId,
      bucket: this.env.BUCKET,
      manifest: this.manifest,
      blobs: this.blobs,
      snapshots: this.snapshots,
      gcGraceMs: gcGraceMs(this.env),
      exclusive: (work) => this.ctx.blockConcurrencyWhile(work),
    });
  }

  private async ensureAlarm(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  private async authed<T>(token: string, run: Authed<T>): Promise<RpcResult<T>> {
    const parsed = parseToken(token);
    if (!parsed || parsed.vaultId !== this.ctx.id.name) return fail("ERR_UNAUTHORIZED", "invalid token");

    const device = this.devices.find(parsed.deviceId);
    const presented = await sha256Hex(token);
    if (!device || !timingSafeEqualHex(presented, device.tokenHash)) return fail("ERR_UNAUTHORIZED", "invalid token");
    if (device.revoked) return fail("ERR_FORBIDDEN", "device has been revoked");
    if (!this.limiter.take(parsed.deviceId)) {
      return fail("ERR_RATE_LIMITED", "too many requests", {
        retryAfterMs: this.limiter.retryAfterMs(parsed.deviceId),
      });
    }

    this.devices.touch(parsed.deviceId, Date.now());
    return run(parsed.deviceId);
  }

  private async registerFromR2(hashes: Sha256[]): Promise<Sha256[]> {
    const unknown = this.blobs.unknown(hashes);
    if (unknown.length === 0 || unknown.length > MAX_R2_LOOKUPS_PER_COMMIT) return unknown;

    const heads = await Promise.all(unknown.map((h) => this.env.BUCKET.head(blobKey(this.vaultId, h))));
    const now = Date.now();
    return unknown.filter((hash, i) => {
      const head = heads[i];
      if (head) this.blobs.register(hash, head.size, now);
      return !head;
    });
  }
}
