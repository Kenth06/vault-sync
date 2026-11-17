import os from "node:os";

import {
  pullOnly as corePull,
  pushOnce,
  syncOnce as coreSync,
  type PushReport,
  type SyncEnvironment,
  type SyncReport,
} from "@vault-sync/sync-core";

import { HttpRemote } from "../adapters/http-remote.ts";
import { NodeFiles } from "../adapters/node-files.ts";
import { ApiClient } from "../clients/api.client.ts";
import type { VaultContext } from "../common/types.ts";
import { loadIgnore } from "../storage/ignore-file.ts";
import type { LocalState } from "../storage/local-state.ts";
import { unsafeOnThisPlatform } from "./fs-safety.ts";

const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";

async function environment(ctx: VaultContext, state: LocalState): Promise<SyncEnvironment> {
  return {
    files: new NodeFiles(ctx.root, state),
    remote: new HttpRemote(new ApiClient(ctx.config.url, ctx.token), ctx.config.vaultId),
    store: state,
    isIgnored: await loadIgnore(ctx.root),
    device: os.hostname(),
    caseInsensitive: CASE_INSENSITIVE,
    unsafePath: unsafeOnThisPlatform,
  };
}

function stamped(state: LocalState, report: SyncReport): SyncReport {
  state.setMeta("lastSyncAt", new Date().toISOString());
  state.setMeta("lastError", "");
  return report;
}

export async function syncOnce(ctx: VaultContext, state: LocalState): Promise<SyncReport> {
  return stamped(state, await coreSync(await environment(ctx, state)));
}

export async function pullOnly(ctx: VaultContext, state: LocalState): Promise<SyncReport> {
  return stamped(state, await corePull(await environment(ctx, state)));
}

export async function pushOnly(ctx: VaultContext, state: LocalState): Promise<PushReport> {
  return pushOnce(await environment(ctx, state));
}
