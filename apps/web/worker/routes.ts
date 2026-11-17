import type { VaultId } from "@vault-sync/protocol";

interface Route {
  readonly method: "GET" | "POST";
  readonly pattern: RegExp;
}

const VAULT_ROUTES: readonly Route[] = [
  { method: "GET", pattern: /^(?:status|tree|history|changes|snapshots|devices|ws)$/u },
  { method: "GET", pattern: /^snapshots\/\d+$/u },
  { method: "GET", pattern: /^raw\/.+$/u },
  { method: "POST", pattern: /^snapshots$/u },
];

const BLOB_CONTENT = /^blobs\/[\da-f]{64}\/content$/u;

export function upstreamPath(method: string, path: string, vaultId: VaultId): string | null {
  const rest = path.replace(/^\/api\//u, "");
  if (method === "GET" && BLOB_CONTENT.test(rest)) return `/v1/${rest}`;
  if (!rest.startsWith("vault/")) return null;
  const tail = rest.slice("vault/".length);
  const allowed = VAULT_ROUTES.some((route) => route.method === method && route.pattern.test(tail));
  return allowed ? `/v1/vaults/${vaultId}/${tail}` : null;
}
