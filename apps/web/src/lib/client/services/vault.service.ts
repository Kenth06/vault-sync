import {
  ChangeRow,
  DeviceSummary,
  SnapshotInfo,
  TreeResponse,
  VaultId,
  VaultStatus,
  type Sha256,
} from "@vault-sync/protocol";
import { z } from "zod";

import { fileUrl, getJson, getText, sendJson } from "../http/api.ts";

const Session = z.object({ vaultId: VaultId }).nullable();
type Session = z.infer<typeof Session>;

const RECENT_CHANGES = 30;

function encodePath(vaultPath: string): string {
  return vaultPath.split("/").map(encodeURIComponent).join("/");
}

export const sessionService = {
  current: (signal?: AbortSignal) => getJson("/session", Session, signal),
  signIn: (vaultId: string, adminSecret: string) =>
    sendJson("/session", { method: "POST", body: { vaultId, adminSecret } }, Session),
  signOut: () => sendJson("/session", { method: "DELETE" }, z.null()),
};

export const vaultService = {
  status: (signal?: AbortSignal) => getJson("/vault/status", VaultStatus, signal),
  tree: (signal?: AbortSignal) => getJson("/vault/tree", TreeResponse, signal),
  devices: (signal?: AbortSignal) => getJson("/vault/devices", DeviceSummary.array(), signal),
  recentChanges: (cursor: number, signal?: AbortSignal) =>
    getJson(
      `/vault/changes?since=${Math.max(0, cursor - RECENT_CHANGES)}&limit=${RECENT_CHANGES}`,
      ChangeRow.array(),
      signal,
    ),
  history: (vaultPath: string, signal?: AbortSignal) =>
    getJson(`/vault/history?path=${encodeURIComponent(vaultPath)}`, ChangeRow.array(), signal),
  snapshots: (signal?: AbortSignal) => getJson("/vault/snapshots", SnapshotInfo.array(), signal),
  snapshotTree: (seq: number, signal?: AbortSignal) => getJson(`/vault/snapshots/${seq}`, TreeResponse, signal),
  createSnapshot: () => sendJson("/vault/snapshots", { method: "POST" }, SnapshotInfo.nullable()),
  currentText: (vaultPath: string, signal?: AbortSignal) => getText(`/vault/raw/${encodePath(vaultPath)}`, signal),
  blobText: (hash: Sha256, signal?: AbortSignal) => getText(`/blobs/${hash}/content`, signal),
  currentUrl: (vaultPath: string) => fileUrl(`/vault/raw/${encodePath(vaultPath)}`),
  blobUrl: (hash: Sha256, vaultPath: string) => fileUrl(`/blobs/${hash}/content?name=${encodeURIComponent(vaultPath)}`),
};
