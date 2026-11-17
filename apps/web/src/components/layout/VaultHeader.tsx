import { useVault } from "../../contexts/VaultContext.tsx";
import { formatBytes, formatCount } from "../../lib/format.ts";

const LIVE_LABEL = { live: "Live", connecting: "Connecting…", offline: "Reconnecting…" } as const;

export function VaultHeader() {
  const { vaultId, status, live } = useVault();
  return (
    <div className="flex flex-col gap-1 px-4 pt-4 pb-3">
      <p className="truncate text-[15px] font-semibold">{vaultId}</p>
      <p className="app-soft flex items-center gap-1.5 text-xs tabular-nums">
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${live === "live" ? "bg-[var(--app-accent)]" : "bg-[var(--app-fg-soft)]"}`}
        />
        <span>{LIVE_LABEL[live]}</span>
        {status !== null && (
          <span className="truncate">
            · {formatCount(status.files, "file")} · {formatBytes(status.bytes)}
          </span>
        )}
      </p>
    </div>
  );
}
