import type { DeviceSummary, TreeEntry, VaultId, VaultStatus } from "@vault-sync/protocol";
import { createContext, use, useMemo, type ReactNode } from "react";

import { useAsync } from "../lib/client/hooks/useAsync.ts";
import { useLiveRevision, type LiveState } from "../lib/client/hooks/useLiveRevision.ts";
import { vaultService } from "../lib/client/services/vault.service.ts";
import { LinkIndex } from "../lib/markdown/links.ts";

interface VaultValue {
  readonly vaultId: VaultId;
  readonly status: VaultStatus | null;
  readonly files: readonly TreeEntry[];
  readonly byPath: ReadonlyMap<string, TreeEntry>;
  readonly index: LinkIndex;
  readonly deviceName: (id: string) => string;
  readonly revision: number;
  readonly live: LiveState;
  readonly loading: boolean;
  readonly error: Error | null;
}

const VaultContext = createContext<VaultValue | null>(null);

function namer(devices: readonly DeviceSummary[] | null): (id: string) => string {
  const names = new Map<string, string>((devices ?? []).map((d) => [d.id, d.name]));
  return (id) => names.get(id) ?? `Device ${id.slice(-4)}`;
}

export function VaultProvider({ vaultId, children }: { readonly vaultId: VaultId; readonly children: ReactNode }) {
  const live = useLiveRevision();
  const status = useAsync((signal) => vaultService.status(signal), vaultId, live.revision);
  const tree = useAsync((signal) => vaultService.tree(signal), vaultId, live.revision);
  const devices = useAsync((signal) => vaultService.devices(signal), vaultId);

  const value = useMemo<VaultValue>(() => {
    const files = tree.data?.files ?? [];
    return {
      vaultId,
      status: status.data,
      files,
      byPath: new Map(files.map((f) => [f.path, f])),
      index: new LinkIndex(files.map((f) => f.path)),
      deviceName: namer(devices.data),
      revision: live.revision,
      live: live.state,
      loading: tree.data === null && tree.loading,
      error: tree.error ?? status.error,
    };
  }, [vaultId, status.data, status.error, tree.data, tree.loading, tree.error, devices.data, live]);

  return <VaultContext value={value}>{children}</VaultContext>;
}

export function useVault(): VaultValue {
  const value = use(VaultContext);
  if (value === null) throw new Error("useVault needs <VaultProvider>");
  return value;
}
